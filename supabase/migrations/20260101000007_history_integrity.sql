-- ============================================================================
-- Learning-history integrity hardening.
--
-- Goals:
--   * A submitted/graded/recorded mock exam can never go back to in_progress,
--     and its version can never decrease, even via a direct table UPDATE that
--     bypasses the RPCs.
--   * A completed study-plan item can never be reverted to pending/skipped by a
--     stale local copy.
--   * Mock exams are created insert-only; creating again (retry/migration) never
--     resets answers, status or version.
--   * Grading / recorded progress (evaluations, status, recordedAttemptIds) is
--     saved through a dedicated monotonic RPC.
--   * submit_attempt requires a matching review round whenever the plan item
--     declares one; a missing round can never silently complete the plan.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Mock exam status/version guard (works for direct UPDATEs too)
-- ---------------------------------------------------------------------------
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
  return new;
end;
$$;

drop trigger if exists mock_exam_sessions_guard_update on public.mock_exam_sessions;
create trigger mock_exam_sessions_guard_update
  before update on public.mock_exam_sessions
  for each row execute function public.guard_mock_exam_session_update();

-- ---------------------------------------------------------------------------
-- Study plan completion is terminal (a stale local copy cannot revert it)
-- ---------------------------------------------------------------------------
create or replace function public.guard_study_plan_item_update()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'PLAN_ITEM_COMPLETED_REGRESSION' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists study_plan_items_guard_update on public.study_plan_items;
create trigger study_plan_items_guard_update
  before update on public.study_plan_items
  for each row execute function public.guard_study_plan_item_update();

-- ---------------------------------------------------------------------------
-- create_mock_exam_session: insert-only. Retrying creation/migration never
-- resets an existing session. Returns whether it was created plus the server
-- status/version/payload so the client can detect a real content conflict.
-- ---------------------------------------------------------------------------
create or replace function public.create_mock_exam_session(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id text := nullif(p_payload->>'id', '');
  v_rows integer := 0;
  v_row public.mock_exam_sessions%rowtype;
begin
  if v_id is null then
    raise exception 'MOCK_SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.mock_exam_sessions (
    id, user_id, subject_id, status, duration_minutes, created_at, ends_at,
    submitted_at, version, payload
  ) values (
    v_id, auth.uid(), p_payload->>'subjectId',
    coalesce(p_payload->>'status', 'in_progress'),
    coalesce((p_payload->>'durationMinutes')::int, 0),
    coalesce((p_payload->>'createdAt')::timestamptz, now()),
    coalesce((p_payload->>'endsAt')::timestamptz, now() + interval '60 minutes'),
    nullif(p_payload->>'submittedAt', '')::timestamptz,
    1, p_payload
  )
  on conflict (id, user_id) do nothing;
  get diagnostics v_rows = row_count;

  select * into v_row from public.mock_exam_sessions
    where id = v_id and user_id = auth.uid();

  return jsonb_build_object(
    'created', v_rows > 0,
    'status', v_row.status,
    'version', v_row.version,
    'payload', v_row.payload
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- save_mock_exam_grading: monotonic transition to graded / recorded. Never
-- accepts in_progress, never lowers the status, preserves answers (payload).
-- ---------------------------------------------------------------------------
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
  if v_session.status = 'recorded' and p_status <> 'recorded' then
    raise exception 'MOCK_SESSION_STATUS_REGRESSION' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and v_session.version <> p_expected_version then
    raise exception 'MOCK_SESSION_STALE' using errcode = 'P0001';
  end if;

  v_new_version := v_session.version + 1;
  update public.mock_exam_sessions
    set payload = p_payload,
        status = p_status,
        submitted_at = coalesce(submitted_at, now()),
        version = v_new_version,
        updated_at = now()
    where id = p_session_id and user_id = auth.uid();

  return jsonb_build_object('version', v_new_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_attempt: require a matching round whenever the plan item declares one.
-- A missing round (null) can never complete a round-bound plan item. Legacy
-- items without a round keep the previous (skip comparison) behavior.
-- ---------------------------------------------------------------------------
create or replace function public.submit_attempt(
  p_attempt jsonb,
  p_event jsonb,
  p_plan_item_id text default null,
  p_plan_round integer default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_attempt_id text := nullif(p_attempt->>'id', '');
  v_event_id text := nullif(p_event->>'id', '');
  v_subject text := nullif(p_attempt->>'subjectId', '');
  v_concept text := nullif(p_attempt->>'conceptId', '');
  v_problem text := nullif(p_attempt->>'problemId', '');
  v_attempt_rows integer := 0;
  v_event_rows integer := 0;
  v_plan public.study_plan_items%rowtype;
  v_plan_status text := 'NOT_ATTEMPTED';
  v_conflict text := null;
  v_plan_concept text;
  v_plan_problem text;
begin
  if v_attempt_id is null or v_subject is null or v_concept is null or v_problem is null then
    raise exception 'ATTEMPT_INCOMPLETE';
  end if;

  if not exists (
    select 1 from public.concepts c
    where c.id = v_concept and c.subject_id = v_subject and c.user_id = auth.uid()
  ) then
    raise exception 'CONCEPT_SCOPE_MISMATCH';
  end if;
  if not exists (
    select 1 from public.problems p
    where p.id = v_problem and p.subject_id = v_subject and p.user_id = auth.uid()
  ) then
    raise exception 'PROBLEM_SCOPE_MISMATCH';
  end if;

  insert into public.attempts (
    id, user_id, subject_id, concept_id, problem_id, mock_exam_session_id, plan_item_id,
    attempt_origin, problem_version, at, calculated_score, payload
  ) values (
    v_attempt_id, auth.uid(), v_subject, v_concept, v_problem,
    nullif(p_attempt->>'mockExamSessionId', ''), nullif(p_attempt->>'planItemId', ''),
    coalesce(p_attempt->>'attemptOrigin', 'independent'),
    coalesce((p_attempt->>'problemVersion')::int, 1),
    coalesce((p_attempt->>'at')::timestamptz, now()),
    coalesce((p_attempt->>'calculatedScore')::numeric, 0),
    p_attempt
  )
  on conflict (id, user_id) do nothing;
  get diagnostics v_attempt_rows = row_count;

  if v_event_id is not null then
    insert into public.review_events (
      id, user_id, subject_id, concept_id, attempt_id, kind, at, result_score, payload
    ) values (
      v_event_id, auth.uid(), v_subject, v_concept, v_attempt_id,
      coalesce(p_event->>'kind', 'attempt'),
      coalesce((p_event->>'at')::timestamptz, now()),
      coalesce((p_event->>'resultScore')::numeric, 0),
      p_event
    )
    on conflict do nothing;
    get diagnostics v_event_rows = row_count;
  end if;

  if p_plan_item_id is not null then
    select * into v_plan from public.study_plan_items
      where id = p_plan_item_id and user_id = auth.uid()
      for update;
    if not found then
      v_plan_status := 'PLAN_ITEM_NOT_FOUND';
    elsif v_plan.status = 'skipped' then
      v_plan_status := 'PLAN_ITEM_SKIPPED';
    else
      v_plan_concept := v_plan.payload->>'conceptId';
      v_plan_problem := v_plan.payload->>'problemId';
      if v_plan.subject_id <> v_subject
         or (v_plan_concept is not null and v_plan_concept <> v_concept)
         or (v_plan_problem is not null and v_plan_problem <> v_problem)
         or (v_plan.round is not null and (p_plan_round is null or v_plan.round <> p_plan_round)) then
        v_plan_status := 'PLAN_ITEM_MISMATCH';
      elsif v_plan.status = 'completed' then
        if v_plan.completed_attempt_id = v_attempt_id then
          v_plan_status := 'PLAN_ITEM_ALREADY_COMPLETED';
        else
          v_plan_status := 'PLAN_ITEM_COMPLETED_BY_OTHER';
          v_conflict := v_plan.completed_attempt_id;
        end if;
      else
        update public.study_plan_items
          set status = 'completed',
              completed_attempt_id = v_attempt_id,
              completed_event_id = v_event_id,
              payload = jsonb_set(jsonb_set(payload, '{status}', '"completed"'), '{completedAt}',
                to_jsonb(coalesce(p_attempt->>'at', now()::text))),
              updated_at = now()
          where id = p_plan_item_id and user_id = auth.uid();
        v_plan_status := 'PLAN_ITEM_COMPLETED';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'attemptId', v_attempt_id,
    'attemptInserted', v_attempt_rows > 0,
    'eventInserted', v_event_rows > 0,
    'planStatus', v_plan_status,
    'conflictAttemptId', v_conflict
  );
end;
$$;
