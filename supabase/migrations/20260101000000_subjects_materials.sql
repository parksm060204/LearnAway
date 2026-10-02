-- ============================================================================
-- Learn my way — cloud storage for subjects and materials (stage 1)
-- Scope: subjects + materials only. Problems/attempts/reviews stay local.
-- Owner is always derived from auth.uid(); clients never send user_id.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- subjects
-- ---------------------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  code text not null default '',
  semester text,
  exam_at timestamptz,
  exam_end_time text,
  location text,
  timezone text not null default 'Asia/Seoul',
  scope text,
  chapters jsonb not null default '[]'::jsonb,
  domain text check (domain in ('math_stats', 'computer_science')),
  engine_name text,
  last_evaluated_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Required for the composite FK that ties materials to the same owner.
  constraint subjects_id_user_unique unique (id, user_id)
);

create index if not exists subjects_user_idx on public.subjects (user_id, updated_at desc);

drop trigger if exists subjects_set_updated_at on public.subjects;
create trigger subjects_set_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- materials
-- Heavy content lives in private Storage; this table stores metadata + paths.
-- ---------------------------------------------------------------------------
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  kind text not null check (kind in ('pdf', 'transcript', 'handout')),
  title text not null,
  source_refs text not null default '',
  -- Conversion status of the parsed body (mirrors the local Material.status).
  status text not null default 'converting'
    check (status in ('ready', 'converting', 'failed', 'needs_review')),
  status_message text,
  is_converted boolean not null default false,
  -- Cloud upload lifecycle, separate from conversion status.
  upload_state text not null default 'uploading'
    check (upload_state in ('uploading', 'ready', 'failed')),
  upload_error text,
  -- Versioned content. Editing writes a new version, then switches the pointer.
  version integer not null default 1 check (version > 0),
  content_hash text,
  original_path text,
  markdown_path text,
  pages_path text,
  transcript_path text,
  page_count integer,
  duration_minutes integer,
  speaker_count integer,
  speakers jsonb not null default '[]'::jsonb,
  has_ai_concepts boolean not null default false,
  has_ai_problems boolean not null default false,
  is_demo boolean not null default false,
  uploaded_at timestamptz not null default now(),
  last_edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A material can only reference a subject owned by the same user.
  constraint materials_subject_owner_fk foreign key (subject_id, user_id)
    references public.subjects (id, user_id) on delete cascade
);

create index if not exists materials_user_subject_idx
  on public.materials (user_id, subject_id, updated_at desc);

drop trigger if exists materials_set_updated_at on public.materials;
create trigger materials_set_updated_at
  before update on public.materials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.subjects enable row level security;
alter table public.materials enable row level security;

drop policy if exists subjects_select_own on public.subjects;
drop policy if exists subjects_insert_own on public.subjects;
drop policy if exists subjects_update_own on public.subjects;
drop policy if exists subjects_delete_own on public.subjects;

create policy subjects_select_own on public.subjects
  for select using (auth.uid() = user_id);
create policy subjects_insert_own on public.subjects
  for insert with check (auth.uid() = user_id);
create policy subjects_update_own on public.subjects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy subjects_delete_own on public.subjects
  for delete using (auth.uid() = user_id);

drop policy if exists materials_select_own on public.materials;
drop policy if exists materials_insert_own on public.materials;
drop policy if exists materials_update_own on public.materials;
drop policy if exists materials_delete_own on public.materials;

-- Materials are owner-scoped AND must reference a subject owned by the same user.
create policy materials_select_own on public.materials
  for select using (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = materials.subject_id and s.user_id = auth.uid()
    )
  );
create policy materials_insert_own on public.materials
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = materials.subject_id and s.user_id = auth.uid()
    )
  );
create policy materials_update_own on public.materials
  for update using (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = materials.subject_id and s.user_id = auth.uid()
    )
  ) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = materials.subject_id and s.user_id = auth.uid()
    )
  );
create policy materials_delete_own on public.materials
  for delete using (
    auth.uid() = user_id
    and exists (
      select 1 from public.subjects s
      where s.id = materials.subject_id and s.user_id = auth.uid()
    )
  );
