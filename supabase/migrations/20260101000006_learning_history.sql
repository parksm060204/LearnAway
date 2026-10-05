-- ============================================================================
-- Learning history: attempts, review events, study plan settings/items and
-- mock exam sessions.
--
-- Design: a few indexed key columns for constraints/queries plus a `payload`
-- jsonb holding the full existing application type (Attempt, ReviewEvent,
-- StudyPlanItem, MockExamSession). Attempts snapshot the problem version and
-- rubric so a later problem edit never changes a past result. History rows are
-- owner-scoped by RLS and reference only the same user's subject/concept/problem.
--
-- Deletion policy: past attempts/review events are preserved. Attempts
-- reference problems with ON DELETE RESTRICT so deleting a problem cannot erase
-- history; deleting a subject cascades.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- attempts
-- ---------------------------------------------------------------------------
create table if not exists public.attempts (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id text not null,
  concept_id text not null,
  problem_id text not null,
  mock_exam_session_id text,
  plan_item_id text,
  attempt_origin text not null default 'independent',
  problem_version integer not null default 1 check (problem_version > 0),
  at timestamptz not null,
  calculated_score numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attempts_pkey primary key (id, user_id),
  constraint attempts_subject_fk foreign key (subject_id, user_id)
    references public.subjects (id, user_id) on delete cascade,
  constraint attempts_concept_fk foreign key (concept_id, subject_id, user_id)
    references public.concepts (id, subject_id, user_id) on delete cascade,
  constraint attempts_problem_fk foreign key (problem_id, subject_id, user_id)
    references public.problems (id, subject_id, user_id) on delete restrict
);

create index if not exists attempts_user_subject_idx on public.attempts (user_id, subject_id, at desc);
create index if not exists attempts_mock_idx on public.attempts (user_id, mock_exam_session_id);

drop trigger if exists attempts_set_updated_at on public.attempts;
create trigger attempts_set_updated_at before update on public.attempts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- review_events
-- ---------------------------------------------------------------------------
create table if not exists public.review_events (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id text not null,
  concept_id text not null,
  attempt_id text,
  kind text not null default 'attempt',
  at timestamptz not null,
  result_score numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint review_events_pkey primary key (id, user_id),
  constraint review_events_subject_fk foreign key (subject_id, user_id)
    references public.subjects (id, user_id) on delete cascade,
  constraint review_events_concept_fk foreign key (concept_id, subject_id, user_id)
    references public.concepts (id, subject_id, user_id) on delete cascade,
  constraint review_events_attempt_fk foreign key (attempt_id, user_id)
    references public.attempts (id, user_id) on delete set null
);

-- One review event per attempt (dedup by attempt id).
create unique index if not exists review_events_attempt_unique
  on public.review_events (attempt_id, user_id) where attempt_id is not null;
create index if not exists review_events_user_concept_idx on public.review_events (user_id, concept_id, at);

-- ---------------------------------------------------------------------------
-- study_plan_settings (one row per user)
-- ---------------------------------------------------------------------------
create table if not exists public.study_plan_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists study_plan_settings_set_updated_at on public.study_plan_settings;
create trigger study_plan_settings_set_updated_at before update on public.study_plan_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- study_plan_items
-- ---------------------------------------------------------------------------
create table if not exists public.study_plan_items (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id text not null,
  kind text not null default '',
  assigned_date text not null default '',
  status text not null default 'pending',
  round integer,
  completed_attempt_id text,
  completed_event_id text,
  completed_mock_session_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_plan_items_pkey primary key (id, user_id),
  constraint study_plan_items_subject_fk foreign key (subject_id, user_id)
    references public.subjects (id, user_id) on delete cascade,
  constraint study_plan_items_attempt_fk foreign key (completed_attempt_id, user_id)
    references public.attempts (id, user_id) on delete set null
);

create index if not exists study_plan_items_user_idx on public.study_plan_items (user_id, assigned_date, status);

drop trigger if exists study_plan_items_set_updated_at on public.study_plan_items;
create trigger study_plan_items_set_updated_at before update on public.study_plan_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- mock_exam_sessions (payload holds frozen problems, answers, evaluations)
-- ---------------------------------------------------------------------------
create table if not exists public.mock_exam_sessions (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'graded', 'recorded', 'abandoned')),
  duration_minutes integer not null default 0,
  created_at timestamptz not null,
  ends_at timestamptz not null,
  submitted_at timestamptz,
  version integer not null default 1 check (version > 0),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint mock_exam_sessions_pkey primary key (id, user_id),
  constraint mock_exam_sessions_subject_fk foreign key (subject_id, user_id)
    references public.subjects (id, user_id) on delete cascade
);

create index if not exists mock_exam_sessions_user_idx on public.mock_exam_sessions (user_id, status, updated_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.attempts enable row level security;
alter table public.review_events enable row level security;
alter table public.study_plan_settings enable row level security;
alter table public.study_plan_items enable row level security;
alter table public.mock_exam_sessions enable row level security;

do $$
declare
  t text;
  own_tables text[] := array['attempts', 'review_events', 'study_plan_settings', 'study_plan_items', 'mock_exam_sessions'];
begin
  foreach t in array own_tables loop
    execute format('drop policy if exists %1$s_select_own on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert_own on public.%1$s', t);
    execute format('drop policy if exists %1$s_update_own on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete_own on public.%1$s', t);
    execute format('create policy %1$s_select_own on public.%1$s for select using (auth.uid() = user_id)', t);
    execute format('create policy %1$s_insert_own on public.%1$s for insert with check (auth.uid() = user_id)', t);
    execute format('create policy %1$s_update_own on public.%1$s for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy %1$s_delete_own on public.%1$s for delete using (auth.uid() = user_id)', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_attempt: atomic, idempotent attempt + review event + plan completion.
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

  -- Ownership + same-subject references enforced explicitly (and by FK).
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

  -- 1) Attempt (idempotent by id).
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

  -- 2) Review event (one per attempt).
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

  -- 3) Plan completion linkage: validate subject/concept/problem/round/skipped.
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
         or (v_plan.round is not null and p_plan_round is not null and v_plan.round <> p_plan_round) then
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
              payload = jsonb_set(payload, '{status}', '"completed"'),
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

-- ---------------------------------------------------------------------------
-- save_mock_exam_answers: debounced autosave with optimistic version + status
-- guard. A submitted exam can never be overwritten by the autosave path.
-- ---------------------------------------------------------------------------
create or replace function public.save_mock_exam_answers(
  p_session_id text,
  p_expected_version integer,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.mock_exam_sessions%rowtype;
  v_new_version integer;
begin
  select * into v_session from public.mock_exam_sessions
    where id = p_session_id and user_id = auth.uid()
    for update;
  if not found then
    raise exception 'MOCK_SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'MOCK_SESSION_LOCKED' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and v_session.version <> p_expected_version then
    raise exception 'MOCK_SESSION_STALE' using errcode = 'P0001';
  end if;

  v_new_version := v_session.version + 1;
  update public.mock_exam_sessions
    set payload = p_payload, version = v_new_version, updated_at = now()
    where id = p_session_id and user_id = auth.uid();

  return jsonb_build_object('version', v_new_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_mock_exam: idempotent final submission.
-- ---------------------------------------------------------------------------
create or replace function public.submit_mock_exam(
  p_session_id text,
  p_expected_version integer,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.mock_exam_sessions%rowtype;
  v_new_version integer;
begin
  select * into v_session from public.mock_exam_sessions
    where id = p_session_id and user_id = auth.uid()
    for update;
  if not found then
    raise exception 'MOCK_SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Already submitted: idempotent success, never overwrite.
  if v_session.status <> 'in_progress' then
    return jsonb_build_object('version', v_session.version, 'alreadySubmitted', true);
  end if;
  if p_expected_version is not null and v_session.version <> p_expected_version then
    raise exception 'MOCK_SESSION_STALE' using errcode = 'P0001';
  end if;

  v_new_version := v_session.version + 1;
  update public.mock_exam_sessions
    set payload = p_payload,
        status = 'submitted',
        submitted_at = now(),
        version = v_new_version,
        updated_at = now()
    where id = p_session_id and user_id = auth.uid();

  return jsonb_build_object('version', v_new_version, 'alreadySubmitted', false);
end;
$$;
