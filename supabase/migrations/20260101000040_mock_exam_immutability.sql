-- ============================================================================
-- Migration 40: Mock exam post-submission immutability enforcement.
--
-- Fixes P1 gap from migration 07:
--   1. guard_mock_exam_session_update() previously checked only status rank
--      and version monotonicity, allowing direct UPDATEs or grading payloads
--      to mutate submitted answers, reasons, frozen problems, and exam metadata.
--   2. save_mock_exam_grading() previously replaced the entire payload column
--      with p_payload. It now rejects any immutable-field mutation with
--      MOCK_SESSION_IMMUTABLE and merges only allowed grading/recording fields
--      (status, evaluations, recordedAttemptIds) onto the existing payload.
--   3. Timestamp comparisons compare timestamptz instants against both the
--      authoritative row column (returned by rowToMockExamSession) and the
--      original payload value, so Z vs +00:00 formatting and server-assigned
--      submitted_at round-trips succeed while real timestamp tampering fails.
-- ============================================================================

create or replace function public.same_mock_exam_timestamp(
  p_new text,
  p_old_payload text,
  p_old_col timestamptz
) returns boolean
language plpgsql
immutable
as $$
declare
  v_new timestamptz;
  v_old_payload timestamptz;
begin
  if nullif(p_new, '') is null then
    return p_old_col is null and nullif(p_old_payload, '') is null;
  end if;

  v_new := p_new::timestamptz;
  if p_old_col is not null and v_new = p_old_col then
    return true;
  end if;
  if nullif(p_old_payload, '') is not null then
    v_old_payload := p_old_payload::timestamptz;
    if v_new = v_old_payload then
      return true;
    end if;
  end if;
  return false;
exception when others then
  return false;
end;
$$;

create or replace function public.guard_mock_exam_session_update()
returns trigger
language plpgsql
as $$
declare
  rank_old integer;
  rank_new integer;
begin
  rank_old := case old.status
    when 'in_progress' then 0 when 'submitted' then 1 when 'graded' then 2
    when 'recorded' then 3 when 'abandoned' then 4 else 9 end;
  rank_new := case new.status
    when 'in_progress' then 0 when 'submitted' then 1 when 'graded' then 2
    when 'recorded' then 3 when 'abandoned' then 4 else 9 end;

  if old.status = 'recorded' and new.status <> 'recorded' then
    raise exception 'MOCK_SESSION_STATUS_REGRESSION' using errcode = 'P0001';
  end if;
  if old.status = 'abandoned' and new.status <> 'abandoned' then
    raise exception 'MOCK_SESSION_STATUS_REGRESSION' using errcode = 'P0001';
  end if;
  if rank_new < rank_old then
    raise exception 'MOCK_SESSION_STATUS_REGRESSION' using errcode = 'P0001';
  end if;
  if new.version < old.version then
    raise exception 'MOCK_SESSION_STALE' using errcode = 'P0001';
  end if;

  -- Once an exam has left in_progress (submitted / graded / recorded / abandoned),
  -- exam configuration, ownership, timestamps, frozen problems, answers, and
  -- Stage 8 reason fields are strictly immutable—even via direct table UPDATEs.
  if old.status <> 'in_progress' then
    if new.id is distinct from old.id
      or new.user_id is distinct from old.user_id
      or new.subject_id is distinct from old.subject_id
      or new.duration_minutes is distinct from old.duration_minutes
      or new.created_at is distinct from old.created_at
      or new.ends_at is distinct from old.ends_at
      or (old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at)
    then
      raise exception 'MOCK_SESSION_IMMUTABLE' using errcode = 'P0001';
    end if;

    if (new.payload->'id') is distinct from (old.payload->'id')
      or (new.payload->'subjectId') is distinct from (old.payload->'subjectId')
      or not public.same_mock_exam_timestamp(new.payload->>'createdAt', old.payload->>'createdAt', old.created_at)
      or not public.same_mock_exam_timestamp(new.payload->>'endsAt', old.payload->>'endsAt', old.ends_at)
      or (
        (old.submitted_at is not null or coalesce(old.payload->>'submittedAt', '') <> '')
        and not public.same_mock_exam_timestamp(new.payload->>'submittedAt', old.payload->>'submittedAt', old.submitted_at)
      )
      or (new.payload->'durationMinutes') is distinct from (old.payload->'durationMinutes')
      or coalesce(new.payload->'selectedConceptIds', '[]'::jsonb)
         is distinct from coalesce(old.payload->'selectedConceptIds', '[]'::jsonb)
      or coalesce(new.payload->'selectedTypes', '[]'::jsonb)
         is distinct from coalesce(old.payload->'selectedTypes', '[]'::jsonb)
      or coalesce(new.payload->'problems', '[]'::jsonb)
         is distinct from coalesce(old.payload->'problems', '[]'::jsonb)
      or coalesce(new.payload->'answers', '{}'::jsonb)
         is distinct from coalesce(old.payload->'answers', '{}'::jsonb)
      or coalesce(new.payload->'reasons', '{}'::jsonb)
         is distinct from coalesce(old.payload->'reasons', '{}'::jsonb)
      or coalesce(new.payload->'isReasonNotApplicable', '{}'::jsonb)
         is distinct from coalesce(old.payload->'isReasonNotApplicable', '{}'::jsonb)
      or coalesce(new.payload->'reasonNotApplicableJustification', '{}'::jsonb)
         is distinct from coalesce(old.payload->'reasonNotApplicableJustification', '{}'::jsonb)
    then
      raise exception 'MOCK_SESSION_IMMUTABLE' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.save_mock_exam_grading(
  p_session_id text,
  p_expected_version integer,
  p_payload jsonb,
  p_status text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.mock_exam_sessions%rowtype;
  v_new_version integer;
  v_merged_payload jsonb;
begin
  if p_status not in ('submitted', 'graded', 'recorded') then
    raise exception 'MOCK_SESSION_STATUS_REGRESSION' using errcode = 'P0001';
  end if;

  select * into v_session from public.mock_exam_sessions
    where id = p_session_id and user_id = auth.uid()
    for update;
  if not found then
    raise exception 'MOCK_SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_session.status = 'in_progress' then
    raise exception 'MOCK_SESSION_LOCKED' using errcode = 'P0001';
  end if;
  if v_session.status = 'abandoned' then
    raise exception 'MOCK_SESSION_STATUS_REGRESSION' using errcode = 'P0001';
  end if;
  if v_session.status = 'recorded' and p_status <> 'recorded' then
    raise exception 'MOCK_SESSION_STATUS_REGRESSION' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and v_session.version <> p_expected_version then
    raise exception 'MOCK_SESSION_STALE' using errcode = 'P0001';
  end if;

  -- Reject any attempt to alter immutable fields instead of silently succeeding.
  if p_payload is not null then
    if ((p_payload ? 'id') and (p_payload->'id') is distinct from (v_session.payload->'id'))
      or ((p_payload ? 'subjectId') and (p_payload->'subjectId') is distinct from (v_session.payload->'subjectId'))
      or ((p_payload ? 'createdAt') and not public.same_mock_exam_timestamp(p_payload->>'createdAt', v_session.payload->>'createdAt', v_session.created_at))
      or ((p_payload ? 'endsAt') and not public.same_mock_exam_timestamp(p_payload->>'endsAt', v_session.payload->>'endsAt', v_session.ends_at))
      or (
        (v_session.submitted_at is not null or coalesce(v_session.payload->>'submittedAt', '') <> '')
        and (p_payload ? 'submittedAt')
        and not public.same_mock_exam_timestamp(p_payload->>'submittedAt', v_session.payload->>'submittedAt', v_session.submitted_at)
      )
      or ((p_payload ? 'durationMinutes') and (p_payload->'durationMinutes') is distinct from (v_session.payload->'durationMinutes'))
      or ((p_payload ? 'selectedConceptIds') and coalesce(p_payload->'selectedConceptIds', '[]'::jsonb) is distinct from coalesce(v_session.payload->'selectedConceptIds', '[]'::jsonb))
      or ((p_payload ? 'selectedTypes') and coalesce(p_payload->'selectedTypes', '[]'::jsonb) is distinct from coalesce(v_session.payload->'selectedTypes', '[]'::jsonb))
      or ((p_payload ? 'problems') and coalesce(p_payload->'problems', '[]'::jsonb) is distinct from coalesce(v_session.payload->'problems', '[]'::jsonb))
      or ((p_payload ? 'answers') and coalesce(p_payload->'answers', '{}'::jsonb) is distinct from coalesce(v_session.payload->'answers', '{}'::jsonb))
      or ((p_payload ? 'reasons') and coalesce(p_payload->'reasons', '{}'::jsonb) is distinct from coalesce(v_session.payload->'reasons', '{}'::jsonb))
      or ((p_payload ? 'isReasonNotApplicable') and coalesce(p_payload->'isReasonNotApplicable', '{}'::jsonb) is distinct from coalesce(v_session.payload->'isReasonNotApplicable', '{}'::jsonb))
      or ((p_payload ? 'reasonNotApplicableJustification') and coalesce(p_payload->'reasonNotApplicableJustification', '{}'::jsonb) is distinct from coalesce(v_session.payload->'reasonNotApplicableJustification', '{}'::jsonb))
    then
      raise exception 'MOCK_SESSION_IMMUTABLE' using errcode = 'P0001';
    end if;
  end if;

  -- Preserve the existing payload and merge ONLY allowed grading/recording fields.
  v_merged_payload := v_session.payload || jsonb_build_object('status', p_status);
  if p_payload is not null and (p_payload ? 'evaluations') then
    v_merged_payload := v_merged_payload || jsonb_build_object(
      'evaluations', coalesce(p_payload->'evaluations', '{}'::jsonb)
    );
  end if;
  if p_payload is not null and (p_payload ? 'recordedAttemptIds') then
    v_merged_payload := v_merged_payload || jsonb_build_object(
      'recordedAttemptIds', coalesce(p_payload->'recordedAttemptIds', '[]'::jsonb)
    );
  end if;
  if coalesce(v_session.payload->>'submittedAt', '') = ''
     and p_payload is not null
     and coalesce(p_payload->>'submittedAt', '') <> '' then
    v_merged_payload := v_merged_payload || jsonb_build_object('submittedAt', p_payload->>'submittedAt');
  end if;

  v_new_version := v_session.version + 1;
  update public.mock_exam_sessions
    set payload = v_merged_payload,
        status = p_status,
        submitted_at = coalesce(submitted_at, now()),
        version = v_new_version,
        updated_at = now()
    where id = p_session_id and user_id = auth.uid();

  return jsonb_build_object('version', v_new_version);
end;
$$;
