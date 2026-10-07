-- Enforce learning invariants at the database boundary and bound authenticated
-- AI evaluation requests. Existing deployed migrations remain immutable.

-- Per-user fixed-window call budget for costly evaluation requests.
create table if not exists public.ai_call_budgets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null,
  call_count integer not null default 0 check (call_count >= 0)
);

alter table public.ai_call_budgets enable row level security;
revoke all on public.ai_call_budgets from anon, authenticated;

create or replace function public.consume_ai_call_budget() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_started timestamptz;
  v_count integer;
  v_retry integer;
  v_limit constant integer := 10;
  v_window_seconds constant integer := 60;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  insert into public.ai_call_budgets (user_id, window_started_at, call_count)
  values (v_uid, now(), 1)
  on conflict (user_id) do update set
    window_started_at = case
      when public.ai_call_budgets.window_started_at + make_interval(secs => v_window_seconds) <= now() then now()
      else public.ai_call_budgets.window_started_at
    end,
    call_count = case
      when public.ai_call_budgets.window_started_at + make_interval(secs => v_window_seconds) <= now() then 1
      else least(public.ai_call_budgets.call_count + 1, v_limit + 1)
    end
  returning window_started_at, call_count into v_started, v_count;

  v_retry := greatest(1, ceil(extract(epoch from (v_started + make_interval(secs => v_window_seconds) - now())))::integer);
  return jsonb_build_object(
    'allowed', v_count <= v_limit,
    'remaining', greatest(0, v_limit - v_count),
    'retryAfterSeconds', v_retry
  );
end;
$$;

revoke execute on function public.consume_ai_call_budget() from public, anon;
grant execute on function public.consume_ai_call_budget() to authenticated;

-- A retry is idempotent only when it carries the same attempt and event.
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
  v_existing_attempt public.attempts%rowtype;
  v_existing_event public.review_events%rowtype;
  v_plan_status text := 'NOT_ATTEMPTED';
  v_conflict text := null;
  v_plan_concept text;
  v_plan_problem text;
begin
  if v_attempt_id is null or v_event_id is null or v_subject is null or v_concept is null or v_problem is null then
    raise exception 'ATTEMPT_INCOMPLETE';
  end if;
  if nullif(p_attempt->>'planItemId', '') is distinct from p_plan_item_id then
    raise exception 'PLAN_ITEM_MISMATCH' using errcode = 'P0001';
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

  if v_attempt_rows = 0 then
    select * into v_existing_attempt from public.attempts
      where id = v_attempt_id and user_id = auth.uid();
    if not found or v_existing_attempt.payload is distinct from p_attempt then
      raise exception 'ATTEMPT_ID_CONFLICT' using errcode = 'P0001';
    end if;
  end if;

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

    if v_event_rows = 0 then
      select * into v_existing_event from public.review_events
        where attempt_id = v_attempt_id and user_id = auth.uid();
      if found then
        if v_existing_event.id <> v_event_id or v_existing_event.payload is distinct from p_event then
          raise exception 'REVIEW_EVENT_ID_CONFLICT' using errcode = 'P0001';
        end if;
      else
        select * into v_existing_event from public.review_events
          where id = v_event_id and user_id = auth.uid();
        if found then
          raise exception 'REVIEW_EVENT_ID_CONFLICT' using errcode = 'P0001';
        end if;
        raise exception 'REVIEW_EVENT_CONFLICT' using errcode = 'P0001';
      end if;
    end if;
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

-- Keep the 100-point rubric and at least one same-subject concept invariant
-- when a problem is revised through the authenticated RPC.
create or replace function public.revise_problem(
  p_problem_id text,
  p_expected_version integer,
  p_problem jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  pr public.problems%rowtype;
  v_same boolean;
  v_new_version integer;
  v_concept_id text;
  v_position integer := 0;
  v_rubric_sum numeric;
  v_rubric_count integer;
  v_bad_rubric_count integer;
  v_concept_count integer;
begin
  select * into pr from public.problems
    where id = p_problem_id and user_id = auth.uid()
    for update;
  if not found then
    raise exception 'PROBLEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if pr.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if p_problem is null or jsonb_typeof(p_problem) <> 'object'
     or coalesce(length(trim(p_problem->>'title')), 0) = 0
     or coalesce(length(trim(p_problem->>'promptText')), 0) = 0
     or coalesce(length(trim(p_problem->>'modelAnswer')), 0) = 0 then
    raise exception 'PROBLEM_INCOMPLETE' using errcode = 'P0001';
  end if;
  if coalesce(p_problem->>'subjectId', '') <> pr.subject_id then
    raise exception 'DRAFT_SCOPE_MISMATCH' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_problem->'rubric') is distinct from 'array' then
    raise exception 'RUBRIC_INVALID' using errcode = 'P0001';
  end if;
  select count(*), coalesce(sum((x.item->>'maxScore')::numeric), 0),
         count(*) filter (where jsonb_typeof(x.item) is distinct from 'object'
           or coalesce(x.item->>'id', '') = ''
           or jsonb_typeof(x.item->'maxScore') is distinct from 'number'
           or coalesce((x.item->>'maxScore')::numeric, 0) <= 0)
    into v_rubric_count, v_rubric_sum, v_bad_rubric_count
    from jsonb_array_elements(p_problem->'rubric') as x(item);
  if v_rubric_count = 0 or v_bad_rubric_count > 0 or v_rubric_sum <> 100
     or (select count(distinct x.item->>'id') from jsonb_array_elements(p_problem->'rubric') as x(item)) <> v_rubric_count then
    raise exception 'RUBRIC_NOT_100' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_problem->'conceptIds') is distinct from 'array' then
    raise exception 'NO_CONCEPT_LINK' using errcode = 'P0001';
  end if;
  select count(*) into v_concept_count
    from jsonb_array_elements_text(p_problem->'conceptIds') as x(id);
  if v_concept_count = 0 or v_concept_count <>
     (select count(distinct x.id) from jsonb_array_elements_text(p_problem->'conceptIds') as x(id)) then
    raise exception 'NO_CONCEPT_LINK' using errcode = 'P0001';
  end if;

  v_same :=
    coalesce(p_problem->>'title', '') = coalesce(pr.payload->>'title', '')
    and coalesce(p_problem->>'promptText', '') = coalesce(pr.payload->>'promptText', '')
    and coalesce(p_problem->>'modelAnswer', '') = coalesce(pr.payload->>'modelAnswer', '')
    and coalesce(p_problem->'rubric', '[]'::jsonb) = coalesce(pr.payload->'rubric', '[]'::jsonb)
    and coalesce(p_problem->'hints', '[]'::jsonb) = coalesce(pr.payload->'hints', '[]'::jsonb)
    and coalesce(p_problem->'conceptIds', '[]'::jsonb) = coalesce(pr.payload->'conceptIds', '[]'::jsonb)
    and coalesce(p_problem->>'appliedConditionNote', '') = coalesce(pr.payload->>'appliedConditionNote', '');

  if v_same then
    update public.problems set
      payload = p_problem,
      is_outdated = coalesce((p_problem->>'isOutdated')::boolean, is_outdated),
      needs_source_review = coalesce((p_problem->>'needsSourceReview')::boolean, needs_source_review),
      quality_status = coalesce(p_problem->>'qualityStatus', quality_status),
      updated_at = now()
    where id = p_problem_id and user_id = auth.uid();
    return pr.version;
  end if;

  v_new_version := pr.version + 1;
  insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
  values (auth.uid(), p_problem_id, pr.subject_id, pr.version, pr.payload)
  on conflict (problem_id, version, user_id) do nothing;

  update public.problems set
    version = v_new_version,
    payload = p_problem,
    title = p_problem->>'title',
    type = coalesce(p_problem->>'type', type),
    is_outdated = coalesce((p_problem->>'isOutdated')::boolean, false),
    needs_source_review = coalesce((p_problem->>'needsSourceReview')::boolean, false),
    quality_status = coalesce(p_problem->>'qualityStatus', 'normal'),
    updated_at = now()
  where id = p_problem_id and user_id = auth.uid();

  insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
  values (auth.uid(), p_problem_id, pr.subject_id, v_new_version, p_problem)
  on conflict (problem_id, version, user_id) do nothing;

  delete from public.problem_concepts where problem_id = p_problem_id and user_id = auth.uid();
  for v_concept_id in select x.id from jsonb_array_elements_text(p_problem->'conceptIds') as x(id) loop
    insert into public.problem_concepts (problem_id, concept_id, subject_id, user_id, position)
    values (p_problem_id, v_concept_id, pr.subject_id, auth.uid(), v_position)
    on conflict (problem_id, concept_id, user_id) do nothing;
    v_position := v_position + 1;
  end loop;

  return v_new_version;
end;
$$;
