-- Preserve the identity of the job that activated the current material row.
-- This lets clients prove a response-loss retry belongs to their own write.
alter table public.materials
  add column if not exists last_completed_job_id text;
