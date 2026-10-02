-- ============================================================================
-- Follow-up migration:
--  - Define the "no active version" representation: `version = 0`.
--  - `pending_version` (the in-progress upload) must be positive when present.
--  - Index for pending-job ownership lookups.
--
-- Storage paths are now job-scoped in the application
-- (<uid>/<material_id>/<job_id>/...), so no schema change is needed for that.
-- ============================================================================

alter table public.materials drop constraint if exists materials_version_check;
alter table public.materials add constraint materials_version_check
  check (version >= 0);

alter table public.materials drop constraint if exists materials_pending_version_check;
alter table public.materials add constraint materials_pending_version_check
  check (pending_version is null or pending_version > 0);

create index if not exists materials_pending_job_idx
  on public.materials (pending_job_id);
