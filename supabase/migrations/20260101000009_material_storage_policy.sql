-- ============================================================================
-- Material storage policy + local-first metadata.
--
-- New materials default to a LOCAL-FIRST policy: the converted body and the PDF
-- original stay on the user's device, and the server stores only the metadata
-- needed to link learning material. Uploading the body and/or the original to
-- Cloud Storage is an explicit per-material choice.
--
-- Existing materials keep their current behaviour: their `sync_body` /
-- `backup_original` policies default to true, and `body_synced` /
-- `original_backed_up` are backfilled from the paths that already exist. No file
-- is ever moved or deleted by this migration.
-- ============================================================================

alter table public.materials
  add column if not exists sync_body boolean not null default true,
  add column if not exists backup_original boolean not null default true,
  add column if not exists body_synced boolean not null default false,
  add column if not exists original_backed_up boolean not null default false,
  add column if not exists original_hash text,
  add column if not exists file_size bigint;

-- Backfill sync state from the paths that already exist, so pre-existing cloud
-- materials are not mislabeled as locally-only.
update public.materials
  set body_synced = (markdown_path is not null),
      original_backed_up = (original_path is not null)
  where body_synced = false and original_backed_up = false;

comment on column public.materials.sync_body is
  'User policy: upload the converted body (markdown/rawText/pages) to Cloud Storage.';
comment on column public.materials.backup_original is
  'User policy: back up the original PDF to Cloud Storage.';
comment on column public.materials.body_synced is
  'Actual sync state: the converted body exists in Cloud Storage.';
comment on column public.materials.original_backed_up is
  'Actual sync state: the original exists in Cloud Storage.';
comment on column public.materials.original_hash is
  'Client-computed hash of the original file (identity / reconnect verification).';
comment on column public.materials.file_size is
  'Original file size in bytes (display / quota planning).';
