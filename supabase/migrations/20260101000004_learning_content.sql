-- ============================================================================
-- Learning content: concepts, concept drafts, problems, problem drafts,
-- problem<->concept links, and immutable problem versions.
--
-- Design: each row keeps a few indexed key columns for constraints/queries plus
-- a `payload jsonb` holding the full existing application type (Concept,
-- ConceptDraft, Problem, ProblemDraft). This preserves every existing field
-- (rubric, hints, model answer, transfer linkage, source hashes, ...) without a
-- lossy column-by-column mapping.
--
-- Owner is always auth.uid() (clients never send user_id). References are
-- constrained to the same user AND subject. Approval runs inside a single
-- transaction (RPC) so partial approval can never be observed, and it is
-- idempotent via the draft's approved_* pointer.
--
-- Attempts / mock exams / review history stay local in this stage.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- concepts
-- ---------------------------------------------------------------------------
create table if not exists public.concepts (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id text not null,
  title text not null,
  order_index integer not null default 0,
  status text not null default 'unstudied',
  current_score numeric not null default 0,
  is_learned boolean not null default false,
  is_demo boolean not null default false,
  version integer not null default 1 check (version > 0),
  draft_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concepts_pkey primary key (id, user_id),
  constraint concepts_id_subject_user_unique unique (id, subject_id, user_id),
  constraint concepts_subject_owner_fk foreign key (subject_id, user_id)
    references public.subjects (id, user_id) on delete cascade
);

create index if not exists concepts_user_subject_idx on public.concepts (user_id, subject_id, order_index);

drop trigger if exists concepts_set_updated_at on public.concepts;
create trigger concepts_set_updated_at before update on public.concepts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- concept_drafts
-- ---------------------------------------------------------------------------
create table if not exists public.concept_drafts (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id text not null,
  material_id text,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  is_approved boolean not null default false,
  content_version integer not null default 1,
  generation_job_id text,
  approved_concept_id text,
  approval_state text not null default 'pending' check (approval_state in ('pending', 'approved', 'failed')),
  approval_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concept_drafts_pkey primary key (id, user_id),
  constraint concept_drafts_subject_owner_fk foreign key (subject_id, user_id)
    references public.subjects (id, user_id) on delete cascade,
  constraint concept_drafts_material_owner_fk foreign key (material_id, user_id)
    references public.materials (id, user_id) on delete cascade
);

create index if not exists concept_drafts_user_subject_idx on public.concept_drafts (user_id, subject_id, updated_at desc);
create index if not exists concept_drafts_job_idx on public.concept_drafts (user_id, generation_job_id);

drop trigger if exists concept_drafts_set_updated_at on public.concept_drafts;
create trigger concept_drafts_set_updated_at before update on public.concept_drafts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- problems
-- ---------------------------------------------------------------------------
create table if not exists public.problems (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id text not null,
  title text not null,
  type text not null,
  is_approved boolean not null default true,
  is_outdated boolean not null default false,
  needs_source_review boolean not null default false,
  quality_status text not null default 'normal',
  version integer not null default 1 check (version > 0),
  draft_id text,
  is_transfer boolean not null default false,
  source_problem_id text,
  logic_session_id text,
  is_demo boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint problems_pkey primary key (id, user_id),
  constraint problems_id_subject_user_unique unique (id, subject_id, user_id),
  constraint problems_subject_owner_fk foreign key (subject_id, user_id)
    references public.subjects (id, user_id) on delete cascade,
  -- A transfer problem must reference a problem in the SAME subject and owner.
  constraint problems_transfer_same_subject_fk foreign key (source_problem_id, subject_id, user_id)
    references public.problems (id, subject_id, user_id) on delete set null
);

create index if not exists problems_user_subject_idx on public.problems (user_id, subject_id, updated_at desc);

drop trigger if exists problems_set_updated_at on public.problems;
create trigger problems_set_updated_at before update on public.problems
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- problem_concepts (multi-concept links, same user + same subject only)
-- ---------------------------------------------------------------------------
create table if not exists public.problem_concepts (
  problem_id text not null,
  concept_id text not null,
  subject_id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position integer not null default 0,
  constraint problem_concepts_pkey primary key (problem_id, concept_id, user_id),
  constraint problem_concepts_problem_fk foreign key (problem_id, subject_id, user_id)
    references public.problems (id, subject_id, user_id) on delete cascade,
  constraint problem_concepts_concept_fk foreign key (concept_id, subject_id, user_id)
    references public.concepts (id, subject_id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- problem_versions (immutable append-only snapshots)
-- ---------------------------------------------------------------------------
create table if not exists public.problem_versions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  problem_id text not null,
  subject_id text not null,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint problem_versions_unique unique (problem_id, version, user_id),
  constraint problem_versions_problem_fk foreign key (problem_id, user_id)
    references public.problems (id, user_id) on delete cascade
);

create index if not exists problem_versions_problem_idx on public.problem_versions (user_id, problem_id, version);

-- ---------------------------------------------------------------------------
-- problem_drafts
-- ---------------------------------------------------------------------------
create table if not exists public.problem_drafts (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id text not null,
  title text not null,
  type text not null,
  status text not null default 'draft' check (status in ('draft', 'needs_review', 'approved', 'rejected')),
  is_approved boolean not null default false,
  is_demo boolean not null default false,
  content_version integer not null default 1,
  generation_job_id text,
  approved_problem_id text,
  approval_state text not null default 'pending' check (approval_state in ('pending', 'approved', 'failed')),
  approval_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint problem_drafts_pkey primary key (id, user_id),
  constraint problem_drafts_subject_owner_fk foreign key (subject_id, user_id)
    references public.subjects (id, user_id) on delete cascade
);

create index if not exists problem_drafts_user_subject_idx on public.problem_drafts (user_id, subject_id, updated_at desc);
create index if not exists problem_drafts_job_idx on public.problem_drafts (user_id, generation_job_id);

drop trigger if exists problem_drafts_set_updated_at on public.problem_drafts;
create trigger problem_drafts_set_updated_at before update on public.problem_drafts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.concepts enable row level security;
alter table public.concept_drafts enable row level security;
alter table public.problems enable row level security;
alter table public.problem_concepts enable row level security;
alter table public.problem_versions enable row level security;
alter table public.problem_drafts enable row level security;

do $$
declare
  t text;
  own_tables text[] := array['concepts', 'concept_drafts', 'problems', 'problem_concepts', 'problem_drafts'];
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

-- problem_versions is append-only: insert + select only (no update/delete).
drop policy if exists problem_versions_select_own on public.problem_versions;
drop policy if exists problem_versions_insert_own on public.problem_versions;
create policy problem_versions_select_own on public.problem_versions for select using (auth.uid() = user_id);
create policy problem_versions_insert_own on public.problem_versions for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Approval RPCs (transactional, idempotent, optimistic-locked)
-- The caller passes the fully-built Concept / Problem document; the server
-- re-validates ownership, subject scope, rubric total and concept links.
-- ---------------------------------------------------------------------------

create or replace function public.approve_concept_draft(
  p_draft_id text,
  p_expected_updated_at timestamptz,
  p_concept jsonb
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  d public.concept_drafts%rowtype;
  v_concept_id text;
begin
  select * into d from public.concept_drafts
    where id = p_draft_id and user_id = auth.uid()
    for update;
  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Idempotent: an already-approved draft returns the created concept.
  if d.approved_concept_id is not null then
    return d.approved_concept_id;
  end if;
  if d.is_approved or d.status <> 'draft' then
    raise exception 'DRAFT_NOT_PENDING';
  end if;
  if p_expected_updated_at is not null and d.updated_at <> p_expected_updated_at then
    raise exception 'DRAFT_STALE' using errcode = 'P0001';
  end if;

  v_concept_id := coalesce(nullif(p_concept->>'id', ''), d.id);
  insert into public.concepts (
    id, user_id, subject_id, title, order_index, status, current_score,
    is_learned, is_demo, version, draft_id, payload
  ) values (
    v_concept_id, auth.uid(), d.subject_id,
    coalesce(p_concept->>'title', d.title),
    coalesce((p_concept->>'order')::int, 0),
    coalesce(p_concept->>'status', 'unstudied'),
    coalesce((p_concept->>'currentScore')::numeric, 0),
    coalesce((p_concept->>'isLearned')::boolean, false),
    false, 1, d.id, p_concept
  )
  on conflict (id, user_id) do nothing;

  update public.concept_drafts
    set status = 'approved', is_approved = true, approved_concept_id = v_concept_id,
        approval_state = 'approved', approval_error = null, updated_at = now()
    where id = p_draft_id and user_id = auth.uid();

  return v_concept_id;
end;
$$;

create or replace function public.approve_problem_draft(
  p_draft_id text,
  p_expected_updated_at timestamptz,
  p_problem jsonb
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  d public.problem_drafts%rowtype;
  v_problem_id text;
  v_rubric_sum numeric;
  v_concept_count integer;
  v_concept_id text;
  v_position integer := 0;
begin
  select * into d from public.problem_drafts
    where id = p_draft_id and user_id = auth.uid()
    for update;
  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.approved_problem_id is not null then
    return d.approved_problem_id;
  end if;
  if d.is_approved or d.status <> 'draft' then
    raise exception 'DRAFT_NOT_PENDING';
  end if;
  if p_expected_updated_at is not null and d.updated_at <> p_expected_updated_at then
    raise exception 'DRAFT_STALE' using errcode = 'P0001';
  end if;

  -- Server-side validation (client validation is not trusted).
  if coalesce(length(trim(p_problem->>'title')), 0) = 0
     or coalesce(length(trim(p_problem->>'promptText')), 0) = 0
     or coalesce(length(trim(p_problem->>'modelAnswer')), 0) = 0 then
    raise exception 'DRAFT_INCOMPLETE';
  end if;

  select coalesce(sum((c->>'maxScore')::numeric), 0) into v_rubric_sum
    from jsonb_array_elements(coalesce(p_problem->'rubric', '[]'::jsonb)) c;
  if v_rubric_sum <> 100 then
    raise exception 'RUBRIC_NOT_100';
  end if;

  select count(*) into v_concept_count
    from jsonb_array_elements_text(coalesce(p_problem->'conceptIds', '[]'::jsonb));
  if v_concept_count = 0 then
    raise exception 'NO_CONCEPT_LINK';
  end if;

  v_problem_id := coalesce(nullif(p_problem->>'id', ''), d.id);
  insert into public.problems (
    id, user_id, subject_id, title, type, is_approved, is_outdated,
    needs_source_review, quality_status, version, draft_id, is_transfer,
    source_problem_id, logic_session_id, is_demo, payload
  ) values (
    v_problem_id, auth.uid(), d.subject_id,
    coalesce(p_problem->>'title', d.title),
    coalesce(p_problem->>'type', d.type),
    true, false, false, 'normal', 1, d.id,
    coalesce((p_problem->>'isTransfer')::boolean, false),
    nullif(p_problem->>'sourceProblemId', ''),
    nullif(p_problem->>'logicSessionId', ''),
    false, p_problem
  )
  on conflict (id, user_id) do nothing;

  -- Every linked concept must exist in the same user + subject (FK enforces).
  for v_concept_id in select jsonb_array_elements_text(coalesce(p_problem->'conceptIds', '[]'::jsonb)) loop
    insert into public.problem_concepts (problem_id, concept_id, subject_id, user_id, position)
    values (v_problem_id, v_concept_id, d.subject_id, auth.uid(), v_position);
    v_position := v_position + 1;
  end loop;

  insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
  values (auth.uid(), v_problem_id, d.subject_id, 1, p_problem)
  on conflict (problem_id, version, user_id) do nothing;

  update public.problem_drafts
    set status = 'approved', is_approved = true, approved_problem_id = v_problem_id,
        approval_state = 'approved', approval_error = null, updated_at = now()
    where id = p_draft_id and user_id = auth.uid();

  return v_problem_id;
end;
$$;
