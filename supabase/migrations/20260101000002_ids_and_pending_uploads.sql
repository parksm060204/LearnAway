-- ============================================================================
-- Follow-up migration:
--  1. IDs become text (existing string ids keep working; new ids are UUIDs),
--     with PER-USER uniqueness so two accounts may share the same legacy id.
--  2. Pending-upload columns so a failed edit never corrupts the active version.
--  3. A 'deleting' upload state so a half-deleted material is not shown as ready.
--
-- Safe to run on databases created by 20260101000000_subjects_materials.sql.
-- ============================================================================

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
