-- Migration 20260101000017: Enhance Analysis Commit and Recovery Safety
-- 1. Returns existing drafts when chunk is already_completed to prevent client draft forgery.
-- 2. Permits safe commit for original lease holder even after lease expiry if no other worker has claimed the chunk.
-- 3. Strictly prevents overwriting or concurrent claim by unauthorized workers.

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
  v_chunk public.analysis_job_chunks%rowtype;
  v_updated integer;
  v_remaining_incomplete integer;
begin
  if p_status not in ('completed', 'failed') then
    return jsonb_build_object('committed', false, 'reason', 'INVALID_STATUS');
  end if;

  -- 1. Strict caller ownership verification against analysis_jobs.user_id
  select * into v_job from public.analysis_jobs
  where id = p_job_id
    and (
      (auth.uid() is not null and user_id = auth.uid())
      or auth.role() = 'service_role'
    );

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'NOT_FOUND_OR_FORBIDDEN');
  end if;

  -- 2. First check if chunk was ALREADY marked completed in the authoritative DB
  select * into v_chunk from public.analysis_job_chunks
  where job_id = p_job_id and chunk_index = p_chunk_index;

  if found and v_chunk.status = 'completed' then
    -- Return authoritative DB drafts, strictly disallowing client drafts from overwriting completed results
    return jsonb_build_object(
      'committed', false,
      'reason', 'already_completed',
      'drafts', v_chunk.drafts
    );
  end if;

  -- 3. Attempt atomic update for the worker holding the lease.
  -- Safe transition: If this worker holds the matching lease_token and lease_worker_id,
  -- and no other worker has claimed the chunk, allow commit even if lease duration lapsed.
  -- If another worker claimed the chunk, lease_token/worker_id will mismatch and be rejected.
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
    and lease_worker_id = p_worker_id;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- Re-check if another worker completed it concurrently
    select * into v_chunk from public.analysis_job_chunks
    where job_id = p_job_id and chunk_index = p_chunk_index and status = 'completed';

    if found then
      return jsonb_build_object(
        'committed', false,
        'reason', 'already_completed',
        'drafts', v_chunk.drafts
      );
    end if;

    return jsonb_build_object('committed', false, 'reason', 'token_mismatch_or_expired');
  end if;

  -- 4. Check if all chunks in the job are completed
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
