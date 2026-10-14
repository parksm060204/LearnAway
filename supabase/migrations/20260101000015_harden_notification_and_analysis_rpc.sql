-- Migration 20260101000015: Harden Notification Dispatch, Chunk Leases, and Service Role Security
-- 1. Revoke public/authenticated access to dispatch RPCs to prevent unauthorized client calls.
-- 2. Add lease/sending tokens and atomic timeout recovery.
-- 3. Add atomic DB chunk lease claiming and result commitment for analysis jobs.

-- A. Notification Dispatch Hardening
alter table public.review_notification_logs
  add column if not exists sending_token uuid default gen_random_uuid(),
  add column if not exists attempt_count integer not null default 1,
  add column if not exists next_retry_at timestamptz;

create index if not exists idx_notification_logs_lookup
  on public.review_notification_logs (user_id, channel, idempotency_key);

-- Atomically claim notification dispatch slot (Strict Server Worker Only)
create or replace function public.claim_notification_dispatch(
  p_user_id uuid,
  p_idempotency_key text,
  p_channel text,
  p_due_item_count integer,
  p_message text,
  p_is_test boolean default false,
  p_lease_duration interval default interval '5 minutes'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.review_notification_subscriptions%rowtype;
  v_log public.review_notification_logs%rowtype;
  v_new_token uuid;
begin
  -- 1. Check user subscription and active consent
  select * into v_sub
  from public.review_notification_subscriptions
  where user_id = p_user_id and channel = p_channel and is_active = true;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'ACTIVE_SUBSCRIPTION_NOT_FOUND');
  end if;

  if v_sub.target is null or length(trim(v_sub.target)) = 0 then
    return jsonb_build_object('allowed', false, 'reason', 'TARGET_NOT_CONFIGURED');
  end if;

  -- 2. Check if a log with this exact user, channel, and idempotency key exists
  select * into v_log
  from public.review_notification_logs
  where user_id = p_user_id and channel = p_channel and idempotency_key = p_idempotency_key;

  if found then
    -- Completed or in-flight (unexpired lease)
    if v_log.status in ('accepted', 'delivered', 'suppressed') then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'ALREADY_DISPATCHED',
        'status', v_log.status,
        'log_id', v_log.id
      );
    end if;

    if v_log.status in ('queued', 'sending') and v_log.created_at > (now() - p_lease_duration) then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'ALREADY_IN_FLIGHT',
        'status', v_log.status,
        'log_id', v_log.id
      );
    end if;

    -- Recover expired or failed dispatch atomically
    v_new_token := gen_random_uuid();
    update public.review_notification_logs
    set status = 'sending',
        sending_token = v_new_token,
        attempt_count = attempt_count + 1,
        error = null,
        created_at = now()
    where id = v_log.id
      and (
        status = 'failed'
        or (status in ('queued', 'sending') and created_at <= (now() - p_lease_duration))
      )
    returning * into v_log;

    if not found then
      return jsonb_build_object('allowed', false, 'reason', 'CONCURRENT_DISPATCH_CONFLICT');
    end if;

    return jsonb_build_object(
      'allowed', true,
      'log_id', v_log.id,
      'sending_token', v_new_token,
      'target', v_sub.target,
      'channel', v_sub.channel,
      'is_retry', true
    );
  end if;

  -- 3. Atomic initial insertion
  v_new_token := gen_random_uuid();
  insert into public.review_notification_logs (
    user_id,
    subscription_id,
    idempotency_key,
    channel,
    status,
    sending_token,
    attempt_count,
    due_item_count,
    message,
    created_at
  ) values (
    p_user_id,
    v_sub.id,
    p_idempotency_key,
    p_channel,
    'sending',
    v_new_token,
    1,
    greatest(0, p_due_item_count),
    p_message,
    now()
  ) returning * into v_log;

  return jsonb_build_object(
    'allowed', true,
    'log_id', v_log.id,
    'sending_token', v_new_token,
    'target', v_sub.target,
    'channel', v_sub.channel,
    'is_retry', false
  );
exception
  when unique_violation then
    return jsonb_build_object('allowed', false, 'reason', 'CONCURRENT_DISPATCH_CONFLICT');
end;
$$;

-- Complete dispatch with sending_token verification (Strict Server Worker Only)
create or replace function public.complete_notification_dispatch(
  p_log_id uuid,
  p_sending_token uuid,
  p_status text,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_status not in ('accepted', 'delivered', 'failed', 'suppressed') then
    return jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  end if;

  update public.review_notification_logs
  set status = p_status,
      error = p_error,
      delivered_at = case when p_status in ('delivered', 'accepted') then now() else null end
  where id = p_log_id
    and status = 'sending'
    and (sending_token is null or sending_token = p_sending_token);

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('success', false, 'error', 'TOKEN_MISMATCH_OR_EXPIRED');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- Explicitly revoke permissions from public, anon, and authenticated
revoke all on function public.claim_notification_dispatch(uuid, text, text, integer, text, boolean, interval) from public, anon, authenticated;
revoke all on function public.complete_notification_dispatch(uuid, uuid, text, text) from public, anon, authenticated;

-- Grant execution ONLY to service_role (server worker)
grant execute on function public.claim_notification_dispatch(uuid, text, text, integer, text, boolean, interval) to service_role;
grant execute on function public.complete_notification_dispatch(uuid, uuid, text, text) to service_role;


-- B. Analysis Chunk DB Lease & Atomic Operation Hardening
alter table public.analysis_job_chunks
  add column if not exists lease_token uuid default gen_random_uuid();

-- Atomically claim analysis chunk lease via DB
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
  select * into v_job from public.analysis_jobs where id = p_job_id;
  if not found then
    return jsonb_build_object('acquired', false, 'reason', 'JOB_NOT_FOUND');
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
    return jsonb_build_object(
      'acquired', false,
      'reason', 'already_completed',
      'drafts', v_chunk.drafts
    );
  end if;

  -- Active lock by another unexpired worker
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

  -- Update parent job status to processing
  update public.analysis_jobs
  set status = 'processing', updated_at = now()
  where id = p_job_id and status in ('pending', 'paused');

  return jsonb_build_object(
    'acquired', true,
    'reason', 'acquired',
    'lease_token', v_new_token,
    'chunk_index', v_chunk.chunk_index
  );
end;
$$;

-- Atomically commit analysis chunk result
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
  v_updated integer;
  v_remaining_incomplete integer;
begin
  if p_status not in ('completed', 'failed') then
    return jsonb_build_object('committed', false, 'reason', 'INVALID_STATUS');
  end if;

  -- Only allow worker holding the matching lease token to commit
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
    and (status = 'running' and lease_token = p_lease_token);

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

-- Pause analysis job
create or replace function public.pause_analysis_job(
  p_job_id text,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.analysis_jobs%rowtype;
begin
  select * into v_job from public.analysis_jobs
  where id = p_job_id and user_id = p_user_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND_OR_FORBIDDEN');
  end if;

  update public.analysis_jobs
  set status = 'paused', updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('success', true, 'status', 'paused');
end;
$$;

-- Resume analysis job
create or replace function public.resume_analysis_job(
  p_job_id text,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.analysis_jobs%rowtype;
begin
  select * into v_job from public.analysis_jobs
  where id = p_job_id and user_id = p_user_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND_OR_FORBIDDEN');
  end if;

  update public.analysis_jobs
  set status = 'processing', updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('success', true, 'status', 'processing');
end;
$$;

-- Revoke execute from public/anon
revoke all on function public.claim_analysis_chunk_lease(text, integer, text, interval) from public, anon;
revoke all on function public.commit_analysis_chunk_result(text, integer, text, uuid, text, jsonb, text) from public, anon;
revoke all on function public.pause_analysis_job(text, uuid) from public, anon;
revoke all on function public.resume_analysis_job(text, uuid) from public, anon;

-- Grant execution to authenticated and service_role
grant execute on function public.claim_analysis_chunk_lease(text, integer, text, interval) to authenticated, service_role;
grant execute on function public.commit_analysis_chunk_result(text, integer, text, uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.pause_analysis_job(text, uuid) to authenticated, service_role;
grant execute on function public.resume_analysis_job(text, uuid) to authenticated, service_role;
