-- ============================================================================
-- Follow-up migration:
--  1. IDs become text (existing string ids keep working; new ids are UUIDs),
--     with PER-USER uniqueness so two accounts may share the same legacy id.
--  2. Pending-upload columns so a failed edit never corrupts the active version.
--  3. A 'deleting' upload state so a half-deleted material is not shown as ready.
--
-- Safe to run on databases created by 20260101000000_subjects_materials.sql.
-- NOTE: RLS policies reference the columns whose type changes, and PostgreSQL
-- refuses to alter a column used in a policy. The policies are dropped first
-- and recreated (identically) at the end.
-- ============================================================================

-- 0) Drop dependent RLS policies ------------------------------------------------
-- `materials_*` policies reference materials.subject_id and subjects.id, so they
-- must be removed before those columns can be retyped.
drop policy if exists materials_select_own on public.materials;
drop policy if exists materials_insert_own on public.materials;
drop policy if exists materials_update_own on public.materials;
drop policy if exists materials_delete_own on public.materials;
-- Dropped and recreated for symmetry/future-proofing.
drop policy if exists subjects_select_own on public.subjects;
drop policy if exists subjects_insert_own on public.subjects;
drop policy if exists subjects_update_own on public.subjects;
drop policy if exists subjects_delete_own on public.subjects;

-- 1) ID policy -----------------------------------------------------------------
alter table public.materials drop constraint if exists materials_subject_owner_fk;
alter table public.materials drop constraint if exists materials_pkey;
alter table public.subjects drop constraint if exists subjects_pkey;
alter table public.subjects drop constraint if exists subjects_id_user_unique;

alter table public.subjects alter column id type text using id::text;
alter table public.subjects alter column id set default gen_random_uuid()::text;
alter table public.materials alter column id type text using id::text;
alter table public.materials alter column id set default gen_random_uuid()::text;
alter table public.materials alter column subject_id type text using subject_id::text;

alter table public.subjects add constraint subjects_pkey primary key (id, user_id);
alter table public.materials add constraint materials_pkey primary key (id, user_id);
alter table public.materials add constraint materials_subject_owner_fk foreign key (subject_id, user_id)
  references public.subjects (id, user_id) on delete cascade;

-- 2) Pending upload columns ----------------------------------------------------
alter table public.materials add column if not exists pending_job_id text;
alter table public.materials add column if not exists pending_version integer;
alter table public.materials add column if not exists pending_upload_state text;
alter table public.materials add column if not exists pending_upload_error text;
alter table public.materials add column if not exists pending_content_hash text;
alter table public.materials add column if not exists pending_original_path text;
alter table public.materials add column if not exists pending_markdown_path text;
alter table public.materials add column if not exists pending_pages_path text;
alter table public.materials add column if not exists pending_transcript_path text;

-- 3) Deleting state ------------------------------------------------------------
alter table public.materials drop constraint if exists materials_upload_state_check;
alter table public.materials add constraint materials_upload_state_check
  check (upload_state in ('uploading', 'ready', 'failed', 'deleting'));

-- 4) Recreate RLS policies -----------------------------------------------------
alter table public.subjects enable row level security;
alter table public.materials enable row level security;

create policy subjects_select_own on public.subjects
  for select using (auth.uid() = user_id);
create policy subjects_insert_own on public.subjects
  for insert with check (auth.uid() = user_id);
create policy subjects_update_own on public.subjects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy subjects_delete_own on public.subjects
  for delete using (auth.uid() = user_id);

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
