-- Migration 20260101000018: Restrict Analysis Lease and Commit to Server Service Role
-- 1. Revoke direct client execution of claim_analysis_chunk_lease and commit_analysis_chunk_result.
--    Only the verified server route handler (running with service_role after signature/ownership check)
--    can claim leases and commit authoritative chunk results.
-- 2. Authenticated users retain read (SELECT) access and pause/resume execution rights for their own jobs.
-- 3. Strictly prevent direct client table modification on analysis_jobs and analysis_job_chunks.

-- Revoke commit and lease execution from public, anon, and authenticated
revoke all on function public.commit_analysis_chunk_result(text, integer, text, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_analysis_chunk_lease(text, integer, text, interval) from public, anon, authenticated;

-- Restrict commit and lease execution strictly to service_role
grant execute on function public.commit_analysis_chunk_result(text, integer, text, uuid, text, jsonb, text) to service_role;
grant execute on function public.claim_analysis_chunk_lease(text, integer, text, interval) to service_role;

-- Maintain user execution for pause and resume (which check auth.uid() = analysis_jobs.user_id)
grant execute on function public.pause_analysis_job(text, uuid) to authenticated, service_role;
grant execute on function public.resume_analysis_job(text, uuid) to authenticated, service_role;

-- Ensure RLS on analysis_jobs and analysis_job_chunks prevents client forge
alter table public.analysis_jobs enable row level security;
alter table public.analysis_job_chunks enable row level security;

-- Drop any lingering direct modification policies for authenticated on chunks
drop policy if exists "Users can insert chunks for their own jobs" on public.analysis_job_chunks;
drop policy if exists "Users can update chunks for their own jobs" on public.analysis_job_chunks;
drop policy if exists "Users can delete chunks for their own jobs" on public.analysis_job_chunks;

-- Allow authenticated users to view only their own jobs and chunks
drop policy if exists "Users can view their own jobs" on public.analysis_jobs;
create policy "Users can view their own jobs" on public.analysis_jobs
  for select using (auth.uid() = user_id);

drop policy if exists "Users can view chunks for their own jobs" on public.analysis_job_chunks;
create policy "Users can view chunks for their own jobs" on public.analysis_job_chunks
  for select using (
    exists (
      select 1 from public.analysis_jobs j
      where j.id = analysis_job_chunks.job_id
        and j.user_id = auth.uid()
    )
  );
