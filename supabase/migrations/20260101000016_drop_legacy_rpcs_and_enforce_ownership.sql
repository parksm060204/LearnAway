-- Migration 20260101000016: Drop Legacy Notification RPC Signatures and Enforce Analysis RPC User Ownership
-- 1. Drop outdated migration 14 notification dispatch RPC overloads to eliminate ambiguity and prevent unauthenticated access.
-- 2. Enforce strict caller ownership (auth.uid() = analysis_jobs.user_id or service_role) on all analysis chunk leasing, commitment, and pause/resume RPCs.
-- 3. Prevent concurrent pause overwrite in claim_analysis_chunk_lease.

-- 1. Drop legacy notification dispatch overloads from migration 14
drop function if exists public.claim_notification_dispatch(uuid, text, text, integer, text, boolean);
drop function if exists public.complete_notification_dispatch(uuid, text, text);

-- Re-verify permissions on migration 15 notification dispatch RPCs
revoke all on function public.claim_notification_dispatch(uuid, text, text, integer, text, boolean, interval) from public, anon, authenticated;
revoke all on function public.complete_notification_dispatch(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_notification_dispatch(uuid, text, text, integer, text, boolean, interval) to service_role;
grant execute on function public.complete_notification_dispatch(uuid, uuid, text, text) to service_role;


-- 2. Hardened claim_analysis_chunk_lease with strict caller ownership verification
create or replace function public.claim_analysis_chunk_lease(
  p_job_id text,
  p_chunk_index integer,
  p_worker_id text,
  p_lease_duration interval default interval '90 seconds'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chunk public.analysis_job_chunks%rowtype;
  v_job public.analysis_jobs%rowtype;
  v_new_token uuid;
begin
  -- 1. Verify caller ownership against analysis_jobs.user_id
  -- Reject if auth.uid() does not match job owner and caller is not service_role
  select * into v_job from public.analysis_jobs
  where id = p_job_id
    and (
      (auth.uid() is not null and user_id = auth.uid())
      or auth.role() = 'service_role'
    );

  if not found then
    -- Return NOT_FOUND_OR_FORBIDDEN without leaking job existence, drafts, or tokens
    return jsonb_build_object('acquired', false, 'reason', 'NOT_FOUND_OR_FORBIDDEN');
  end if;

  if v_job.status = 'paused' then
    return jsonb_build_object('acquired', false, 'reason', 'JOB_PAUSED');
  end if;

  select * into v_chunk
  from public.analysis_job_chunks
  where job_id = p_job_id and chunk_index = p_chunk_index;

  if not found then
    return jsonb_build_object('acquired', false, 'reason', 'CHUNK_NOT_FOUND');
  end if;

  if v_chunk.status = 'completed' then
    -- Only returned to verified owner or service_role
    return jsonb_build_object(
      'acquired', false,
      'reason', 'already_completed',
      'drafts', v_chunk.drafts
    );
  end if;

  -- Active lock held by an unexpired worker
  if v_chunk.status = 'running' and v_chunk.lease_expires_at > now() and v_chunk.lease_worker_id <> p_worker_id then
    return jsonb_build_object('acquired', false, 'reason', 'locked');
  end if;

  -- Atomically acquire lease
  v_new_token := gen_random_uuid();
  update public.analysis_job_chunks
  set status = 'running',
      lease_worker_id = p_worker_id,
      lease_token = v_new_token,
      lease_expires_at = now() + p_lease_duration,
      attempt_count = attempt_count + 1,
      updated_at = now()
  where job_id = p_job_id
    and chunk_index = p_chunk_index
    and (
      status in ('pending', 'failed')
      or lease_expires_at <= now()
      or lease_worker_id = p_worker_id
    )
  returning * into v_chunk;

  if not found then
    return jsonb_build_object('acquired', false, 'reason', 'CONCURRENT_CLAIM_CONFLICT');
  end if;

  -- Update parent job status to processing ONLY IF currently pending.
  -- Do NOT overwrite 'paused' if a concurrent pause request was processed!
  update public.analysis_jobs
  set status = 'processing', updated_at = now()
  where id = p_job_id and status = 'pending';

  return jsonb_build_object(
    'acquired', true,
    'reason', 'acquired',
    'lease_token', v_new_token,
    'chunk_index', v_chunk.chunk_index
  );
end;
$$;


-- 3. Hardened commit_analysis_chunk_result with strict caller ownership & token verification
create or replace function public.commit_analysis_chunk_result(
  p_job_id text,
  p_chunk_index integer,
  p_worker_id text,
  p_lease_token uuid,
  p_status text,
  p_drafts jsonb,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.analysis_jobs%rowtype;
  v_updated integer;
  v_remaining_incomplete integer;
begin
  if p_status not in ('completed', 'failed') then
    return jsonb_build_object('committed', false, 'reason', 'INVALID_STATUS');
  end if;

  -- 1. Verify caller ownership against analysis_jobs.user_id
  select * into v_job from public.analysis_jobs
  where id = p_job_id
    and (
      (auth.uid() is not null and user_id = auth.uid())
      or auth.role() = 'service_role'
    );

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'NOT_FOUND_OR_FORBIDDEN');
  end if;

  -- 2. Only allow worker holding the matching unexpired lease token to commit
  update public.analysis_job_chunks
  set status = p_status,
      drafts = case when p_status = 'completed' then p_drafts else '[]'::jsonb end,
      last_error = p_error,
      completed_at = case when p_status = 'completed' then now() else null end,
      lease_worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where job_id = p_job_id
    and chunk_index = p_chunk_index
    and status = 'running'
    and lease_token = p_lease_token
    and lease_worker_id = p_worker_id
    and lease_expires_at > now();

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- Check if it was already marked completed
    if exists (
      select 1 from public.analysis_job_chunks
      where job_id = p_job_id and chunk_index = p_chunk_index and status = 'completed'
    ) then
      return jsonb_build_object('committed', false, 'reason', 'already_completed');
    end if;
    return jsonb_build_object('committed', false, 'reason', 'token_mismatch_or_expired');
  end if;

  -- Check if all chunks completed
  select count(*) into v_remaining_incomplete
  from public.analysis_job_chunks
  where job_id = p_job_id and status <> 'completed';

  if v_remaining_incomplete = 0 then
    update public.analysis_jobs
    set status = 'completed', updated_at = now()
    where id = p_job_id;
  end if;

  return jsonb_build_object('committed', true, 'reason', 'committed');
end;
$$;


-- 4. Hardened pause_analysis_job verifying caller auth.uid() against job owner
create or replace function public.pause_analysis_job(
  p_job_id text,
  p_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.analysis_jobs%rowtype;
begin
  -- Validate caller: must match auth.uid() or be service_role
  select * into v_job from public.analysis_jobs
  where id = p_job_id
    and (
      (auth.uid() is not null and user_id = auth.uid() and (p_user_id is null or p_user_id = auth.uid()))
      or (auth.role() = 'service_role' and (p_user_id is null or user_id = p_user_id))
    );

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND_OR_FORBIDDEN');
  end if;

  update public.analysis_jobs
  set status = 'paused', updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('success', true, 'status', 'paused');
end;
$$;


-- 5. Hardened resume_analysis_job verifying caller auth.uid() against job owner
create or replace function public.resume_analysis_job(
  p_job_id text,
  p_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.analysis_jobs%rowtype;
begin
  -- Validate caller: must match auth.uid() or be service_role
  select * into v_job from public.analysis_jobs
  where id = p_job_id
    and (
      (auth.uid() is not null and user_id = auth.uid() and (p_user_id is null or p_user_id = auth.uid()))
      or (auth.role() = 'service_role' and (p_user_id is null or user_id = p_user_id))
    );

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND_OR_FORBIDDEN');
  end if;

  update public.analysis_jobs
  set status = 'processing', updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('success', true, 'status', 'processing');
end;
$$;


-- Permissions: authenticated users and service_role can call the hardened analysis functions
revoke all on function public.claim_analysis_chunk_lease(text, integer, text, interval) from public, anon;
revoke all on function public.commit_analysis_chunk_result(text, integer, text, uuid, text, jsonb, text) from public, anon;
revoke all on function public.pause_analysis_job(text, uuid) from public, anon;
revoke all on function public.resume_analysis_job(text, uuid) from public, anon;

grant execute on function public.claim_analysis_chunk_lease(text, integer, text, interval) to authenticated, service_role;
grant execute on function public.commit_analysis_chunk_result(text, integer, text, uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.pause_analysis_job(text, uuid) to authenticated, service_role;
grant execute on function public.resume_analysis_job(text, uuid) to authenticated, service_role;

-- 6. Prevent bypassing RPC lease/commit validations via direct table UPDATE
-- Chunks and job statuses must ONLY be altered via the validated SECURITY DEFINER RPCs above.
drop policy if exists "Users can update chunks for their own jobs" on public.analysis_job_chunks;

