-- ============================================================================
-- Migration 26: Temporary PDF Security Hardening & Strict Fencing Tokens
--
-- 1. Drops legacy overloaded RPCs for trial credits:
--    - record_trial_result_ready(text, jsonb, uuid)
--    - settle_trial_credit(text, uuid)
--    - release_trial_credit(text, text, uuid)
-- 2. Enforces mandatory, non-empty fencing lease tokens on record_trial_result_ready,
--    settle_trial_credit, and release_trial_credit. Null/empty/mismatched tokens are strictly rejected.
-- 3. Enforces strict state machine transitions in trial reservations:
--    - Released/refunded tasks cannot be settled without re-deduction.
--    - Settled tasks cannot be reverted to result_ready or have results overwritten.
--    - Settling requires valid cached_result to prevent settling without persistence.
-- 4. Restricts temp_pdf_conversion_jobs ledger mutations strictly to service_role:
--    - Revokes INSERT, UPDATE, DELETE from authenticated and public.
--    - Keeps only restricted SELECT for authenticated owners.
-- 5. Updates status check constraint for temp_pdf_conversion_jobs to include
--    'cleaning' and 'quarantined'.
-- 6. Implements atomic, concurrency-safe cleanup claim RPC:
--    - claim_expired_temp_pdf_jobs(p_limit integer) using FOR UPDATE SKIP LOCKED
--    - Safely reclaims abandoned converting jobs older than 10 minutes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Clean up legacy overloaded RPC functions
-- ----------------------------------------------------------------------------
do $$ begin
  revoke execute on function public.record_trial_result_ready(text, jsonb, uuid) from public, anon, authenticated;
exception when undefined_function then null;
end $$;
drop function if exists public.record_trial_result_ready(text, jsonb, uuid);

do $$ begin
  revoke execute on function public.settle_trial_credit(text, uuid) from public, anon, authenticated;
exception when undefined_function then null;
end $$;
drop function if exists public.settle_trial_credit(text, uuid);

do $$ begin
  revoke execute on function public.release_trial_credit(text, text, uuid) from public, anon, authenticated;
exception when undefined_function then null;
end $$;
drop function if exists public.release_trial_credit(text, text, uuid);

-- ----------------------------------------------------------------------------
-- 2. Hardened record_trial_result_ready with strict lease token & state transition
-- ----------------------------------------------------------------------------
create or replace function public.record_trial_result_ready(
  p_task_id text,
  p_result jsonb,
  p_user_id uuid default null,
  p_lease_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_res public.ai_trial_reservations%rowtype;
  v_token text := trim(coalesce(p_lease_token, ''));
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'error', '권한이 없습니다 (service_role 전용).',
      'error_code', 'FORBIDDEN'
    );
  end if;

  if coalesce(p_task_id, '') = '' then
    return jsonb_build_object(
      'success', false,
      'error', '작업 식별자(task_id)가 필요합니다.',
      'error_code', 'INVALID_PARAMETERS'
    );
  end if;

  if v_token = '' then
    return jsonb_build_object(
      'success', false,
      'error', '유효한 실행 토큰(lease_token)이 필요합니다.',
      'error_code', 'LEASE_TOKEN_REQUIRED'
    );
  end if;

  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', '예약 내역을 찾을 수 없습니다.',
      'error_code', 'RESERVATION_NOT_FOUND'
    );
  end if;

  if v_res.user_id <> v_uid then
    return jsonb_build_object(
      'success', false,
      'error', '사용자 소유권이 일치하지 않습니다.',
      'error_code', 'TASK_OWNERSHIP_MISMATCH'
    );
  end if;

  -- Strict fencing token check: null in db or mismatch rejects stale execution
  if v_res.lease_token is null or v_res.lease_token <> v_token then
    return jsonb_build_object(
      'success', false,
      'error', '만료되었거나 유효하지 않은 실행 토큰(fencing token)입니다.',
      'error_code', 'STALE_LEASE_TOKEN'
    );
  end if;

  -- State machine validation: settled tasks CANNOT be reverted or overwritten
  if v_res.status = 'settled' then
    return jsonb_build_object(
      'success', false,
      'error', '이미 최종 확정(settled)된 작업의 결과는 덮어쓸 수 없습니다.',
      'error_code', 'ALREADY_SETTLED'
    );
  end if;

  -- State machine validation: refunded tasks CANNOT record results
  if v_res.status in ('released', 'failed_refunded') then
    return jsonb_build_object(
      'success', false,
      'error', '이미 환급된 작업의 결과를 기록할 수 없습니다.',
      'error_code', 'ALREADY_REFUNDED'
    );
  end if;

  update public.ai_trial_reservations
  set cached_result = p_result,
      status = 'result_ready',
      lease_expires_at = null,
      error_code = null
  where task_id = p_task_id;

  return jsonb_build_object('success', true, 'status', 'result_ready');
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Hardened settle_trial_credit with strict lease token, result verification & state guard
-- ----------------------------------------------------------------------------
create or replace function public.settle_trial_credit(
  p_task_id text,
  p_user_id uuid default null,
  p_lease_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_res public.ai_trial_reservations%rowtype;
  v_token text := trim(coalesce(p_lease_token, ''));
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'message', '권한이 없습니다 (service_role 전용).',
      'error_code', 'FORBIDDEN'
    );
  end if;

  if coalesce(p_task_id, '') = '' then
    return jsonb_build_object(
      'success', false,
      'message', '작업 식별자가 필요합니다.',
      'error_code', 'INVALID_PARAMETERS'
    );
  end if;

  if v_token = '' then
    return jsonb_build_object(
      'success', false,
      'message', '유효한 실행 토큰(lease_token)이 필요합니다.',
      'error_code', 'LEASE_TOKEN_REQUIRED'
    );
  end if;

  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'message', '예약 내역을 찾을 수 없습니다.',
      'error_code', 'RESERVATION_NOT_FOUND'
    );
  end if;

  if v_res.user_id <> v_uid then
    return jsonb_build_object(
      'success', false,
      'message', '사용자 소유권이 일치하지 않습니다.',
      'error_code', 'TASK_OWNERSHIP_MISMATCH'
    );
  end if;

  -- Fencing token check
  if v_res.lease_token is null or v_res.lease_token <> v_token then
    return jsonb_build_object(
      'success', false,
      'message', '만료되었거나 유효하지 않은 실행 토큰입니다.',
      'error_code', 'STALE_LEASE_TOKEN'
    );
  end if;

  -- Already settled with same valid token is idempotent success
  if v_res.status = 'settled' then
    return jsonb_build_object('success', true, 'status', 'settled');
  end if;

  -- Refunded tasks CANNOT be settled without a new reservation & deduction
  if v_res.status in ('released', 'failed_refunded') then
    return jsonb_build_object(
      'success', false,
      'message', '이미 환급된 작업은 재차감 없이 확정할 수 없습니다.',
      'error_code', 'ALREADY_REFUNDED'
    );
  end if;

  -- MUST have cached_result to settle (protects against credit deduction without result)
  if v_res.cached_result is null then
    return jsonb_build_object(
      'success', false,
      'message', '보존된 AI 결과가 없어 크레딧을 확정할 수 없습니다.',
      'error_code', 'MISSING_CACHED_RESULT'
    );
  end if;

  update public.ai_trial_reservations
  set status = 'settled',
      settled_at = coalesce(settled_at, now()),
      lease_expires_at = null
  where task_id = p_task_id;

  return jsonb_build_object('success', true, 'status', 'settled');
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Hardened release_trial_credit with strict lease token & state guard
-- ----------------------------------------------------------------------------
create or replace function public.release_trial_credit(
  p_task_id text,
  p_reason text default null,
  p_user_id uuid default null,
  p_lease_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_res public.ai_trial_reservations%rowtype;
  v_new_balance integer;
  v_token text := trim(coalesce(p_lease_token, ''));
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'message', '권한이 없습니다 (service_role 전용).',
      'error_code', 'FORBIDDEN'
    );
  end if;

  if coalesce(p_task_id, '') = '' then
    return jsonb_build_object(
      'success', false,
      'message', '작업 식별자가 필요합니다.',
      'error_code', 'INVALID_PARAMETERS'
    );
  end if;

  if v_token = '' then
    return jsonb_build_object(
      'success', false,
      'message', '유효한 실행 토큰(lease_token)이 필요합니다.',
      'error_code', 'LEASE_TOKEN_REQUIRED'
    );
  end if;

  -- Consistent locking order: lock reservation row first
  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'message', '예약 내역을 찾을 수 없습니다.',
      'error_code', 'RESERVATION_NOT_FOUND'
    );
  end if;

  if v_res.user_id <> v_uid then
    return jsonb_build_object(
      'success', false,
      'message', '사용자 소유권이 일치하지 않습니다.',
      'error_code', 'TASK_OWNERSHIP_MISMATCH'
    );
  end if;

  -- Fencing token check
  if v_res.lease_token is null or v_res.lease_token <> v_token then
    return jsonb_build_object(
      'success', false,
      'message', '만료되었거나 유효하지 않은 실행 토큰입니다.',
      'error_code', 'STALE_LEASE_TOKEN'
    );
  end if;

  -- If already settled, CANNOT refund!
  if v_res.status = 'settled' then
    return jsonb_build_object(
      'success', false,
      'message', '이미 확정된 작업은 환급할 수 없습니다.',
      'error_code', 'ALREADY_SETTLED'
    );
  end if;

  -- If already released/refunded, idempotent return without double refund
  if v_res.status in ('released', 'failed_refunded') then
    select balance into v_new_balance from public.ai_trial_credits where user_id = v_uid;
    return jsonb_build_object(
      'success', true,
      'status', v_res.status,
      'refunded', false,
      'balance', coalesce(v_new_balance, 0),
      'remaining', coalesce(v_new_balance, 0)
    );
  end if;

  -- Lock user credit row second
  select balance into v_new_balance
  from public.ai_trial_credits
  where user_id = v_uid
  for update;

  -- Refund 1 credit back to user balance (capped at granted_credits)
  update public.ai_trial_credits
  set balance = least(balance + 1, granted_credits),
      updated_at = now()
  where user_id = v_uid
  returning balance into v_new_balance;

  update public.ai_trial_reservations
  set status = 'released',
      released_at = now(),
      release_reason = coalesce(p_reason, 'cancelled_or_failed'),
      lease_expires_at = null
  where task_id = p_task_id;

  return jsonb_build_object(
    'success', true,
    'status', 'released',
    'refunded', true,
    'balance', v_new_balance,
    'remaining', v_new_balance
  );
end;
$$;

-- Enforce strict service_role permissions on trial RPCs
revoke all on function public.record_trial_result_ready(text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.record_trial_result_ready(text, jsonb, uuid, text) to service_role;

revoke all on function public.settle_trial_credit(text, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_trial_credit(text, uuid, text) to service_role;

revoke all on function public.release_trial_credit(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.release_trial_credit(text, text, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Lock down temp_pdf_conversion_jobs: service_role mutations only
-- ----------------------------------------------------------------------------
-- Revoke INSERT, UPDATE, DELETE from authenticated users
revoke insert, update, delete on public.temp_pdf_conversion_jobs from public, anon, authenticated;
grant select on public.temp_pdf_conversion_jobs to authenticated;
grant all on public.temp_pdf_conversion_jobs to service_role;

-- Update RLS policy to SELECT only for authenticated owners
drop policy if exists temp_pdf_jobs_owner_policy on public.temp_pdf_conversion_jobs;
create policy temp_pdf_jobs_owner_policy on public.temp_pdf_conversion_jobs
  for select using (auth.uid() = user_id);

-- Update check constraint on status column to allow 'cleaning' and 'quarantined'
alter table public.temp_pdf_conversion_jobs
  drop constraint if exists temp_pdf_conversion_jobs_status_check;

alter table public.temp_pdf_conversion_jobs
  add constraint temp_pdf_conversion_jobs_status_check
  check (status in ('ticket_issued', 'uploaded', 'converting', 'completed', 'failed', 'cancelled', 'cleaned', 'cleaning', 'quarantined'));

-- Add lease_token and lease_expires_at for atomic lease/fencing on transient jobs
alter table public.temp_pdf_conversion_jobs
  add column if not exists lease_token text,
  add column if not exists lease_expires_at timestamptz;

create index if not exists temp_pdf_jobs_lease_idx
  on public.temp_pdf_conversion_jobs (status, lease_expires_at);

-- ----------------------------------------------------------------------------
-- 6. Atomic Concurrency-Safe Cleanup Claim RPC with Interrupted Cleaning Recovery
-- ----------------------------------------------------------------------------
-- Drops legacy get_expired_temp_pdf_jobs if existing
drop function if exists public.get_expired_temp_pdf_jobs(integer);

-- Atomically claims expired jobs, stalled converting (>10m), and interrupted cleaning (>5m) using FOR UPDATE SKIP LOCKED
create or replace function public.claim_expired_temp_pdf_jobs(
  p_limit integer default 50
)
returns setof public.temp_pdf_conversion_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role permission required';
  end if;

  -- 1. Automatically quarantine repeatedly failing jobs to prevent infinite reclaim loops
  update public.temp_pdf_conversion_jobs
  set status = 'quarantined',
      cleanup_error = coalesce(cleanup_error, 'MAX_CLEANUP_ATTEMPTS_EXCEEDED'),
      updated_at = now()
  where status not in ('cleaned', 'quarantined')
    and cleanup_attempts >= 5;

  -- 2. Atomically select and claim eligible candidates with fresh fencing lease tokens
  return query
  with candidates as (
    select job_id
    from public.temp_pdf_conversion_jobs
    where (
      -- Expired uncleaned jobs (under max attempts)
      (expires_at < now() and status not in ('cleaned', 'cleaning', 'quarantined', 'converting') and cleanup_attempts < 5)
      or
      -- Abandoned/stalled converting jobs: expired lease or older than 10 minutes
      (status = 'converting' and ((lease_expires_at is not null and lease_expires_at < now()) or updated_at < now() - interval '10 minutes') and cleanup_attempts < 5)
      or
      -- Stranded uploads or unused tickets older than 2 hours
      (status in ('ticket_issued', 'uploaded') and created_at < now() - interval '2 hours' and cleanup_attempts < 5)
      or
      -- Interrupted cleaning jobs: expired lease or older than 5 minutes (Safe Re-claim)
      (status = 'cleaning' and ((lease_expires_at is not null and lease_expires_at < now()) or updated_at < now() - interval '5 minutes') and cleanup_attempts < 5)
    )
    order by expires_at asc
    limit coalesce(p_limit, 50)
    for update skip locked
  )
  update public.temp_pdf_conversion_jobs j
  set status = 'cleaning',
      lease_token = gen_random_uuid()::text,
      lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  from candidates c
  where j.job_id = c.job_id
  returning j.*;
end;
$$;

revoke all on function public.claim_expired_temp_pdf_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_expired_temp_pdf_jobs(integer) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Atomic Concurrency-Safe Conversion Claim RPC (Anti-Race with Cleanup)
-- ----------------------------------------------------------------------------
create or replace function public.claim_temp_pdf_job_for_conversion(
  p_job_id text,
  p_user_id uuid,
  p_lease_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.temp_pdf_conversion_jobs%rowtype;
  v_token text := coalesce(nullif(trim(p_lease_token), ''), gen_random_uuid()::text);
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'service_role 권한이 필요합니다.'
    );
  end if;

  if coalesce(p_job_id, '') = '' or p_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_PARAMETERS',
      'error', '작업 식별자 또는 사용자 식별자가 누락되었습니다.'
    );
  end if;

  select * into v_job
  from public.temp_pdf_conversion_jobs
  where job_id = p_job_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'code', 'JOB_NOT_FOUND',
      'error', '임시 작업 내역을 찾을 수 없습니다.'
    );
  end if;

  if v_job.user_id <> p_user_id then
    return jsonb_build_object(
      'success', false,
      'code', 'STORAGE_ACCESS_DENIED',
      'error', '작업 접근 권한이 없습니다.'
    );
  end if;

  -- Block jobs already claimed by Cron cleanup or terminal states
  if v_job.status in ('cleaned', 'cleaning', 'quarantined', 'cancelled') then
    return jsonb_build_object(
      'success', false,
      'code', 'JOB_NOT_CONVERTIBLE',
      'status', v_job.status,
      'error', '해당 작업은 이미 정리 중이거나 종료되어 변환할 수 없습니다.'
    );
  end if;

  -- Block expired jobs: never sign or convert expired transient files!
  if v_job.expires_at <= now() then
    return jsonb_build_object(
      'success', false,
      'code', 'JOB_EXPIRED',
      'status', v_job.status,
      'error', '임시 파일 유효시간이 만료되었습니다.'
    );
  end if;

  -- Block concurrent duplicate conversions actively leased
  if v_job.status = 'converting' and v_job.lease_expires_at is not null and v_job.lease_expires_at > now() then
    return jsonb_build_object(
      'success', false,
      'code', 'CONCURRENT_CONVERSION',
      'status', v_job.status,
      'error', '동일한 작업이 현재 변환 처리 중입니다.'
    );
  end if;

  -- Transition atomically to converting with fencing lease
  update public.temp_pdf_conversion_jobs
  set status = 'converting',
      lease_token = v_token,
      lease_expires_at = now() + interval '10 minutes',
      updated_at = now()
  where job_id = p_job_id;

  return jsonb_build_object(
    'success', true,
    'job_id', v_job.job_id,
    'storage_path', v_job.storage_path,
    'file_name', v_job.file_name,
    'lease_token', v_token
  );
end;
$$;

revoke all on function public.claim_temp_pdf_job_for_conversion(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_temp_pdf_job_for_conversion(text, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 8. Atomic Converter Cleanup Claim RPC (Anti-Race with Concurrent Converters & Cron)
-- ----------------------------------------------------------------------------
create or replace function public.claim_temp_pdf_cleanup_by_converter(
  p_job_id text,
  p_user_id uuid,
  p_lease_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.temp_pdf_conversion_jobs%rowtype;
  v_cleanup_token text;
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'service_role permission required');
  end if;

  if p_job_id is null or p_lease_token is null or trim(p_lease_token) = '' then
    return jsonb_build_object('success', false, 'error', 'INVALID_PARAMETERS');
  end if;

  select * into v_job
  from public.temp_pdf_conversion_jobs
  where job_id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND');
  end if;

  if v_job.user_id <> p_user_id then
    return jsonb_build_object('success', false, 'error', 'STORAGE_ACCESS_DENIED');
  end if;

  if v_job.lease_token is distinct from p_lease_token then
    return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN');
  end if;

  if v_job.status <> 'converting' then
    return jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_job.status);
  end if;

  if v_job.lease_expires_at is not null and v_job.lease_expires_at <= now() then
    return jsonb_build_object('success', false, 'error', 'LEASE_EXPIRED');
  end if;

  v_cleanup_token := gen_random_uuid()::text;

  update public.temp_pdf_conversion_jobs
  set status = 'cleaning',
      lease_token = v_cleanup_token,
      lease_expires_at = now() + interval '60 seconds',
      updated_at = now()
  where job_id = p_job_id
    and lease_token = p_lease_token
    and status = 'converting';

  return jsonb_build_object(
    'success', true,
    'job_id', p_job_id,
    'cleanup_token', v_cleanup_token
  );
end;
$$;

revoke all on function public.claim_temp_pdf_cleanup_by_converter(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_temp_pdf_cleanup_by_converter(text, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 9. Atomic Cleanup Finalization RPC (Strict Token Verification on All Exit Paths)
-- ----------------------------------------------------------------------------
create or replace function public.finalize_temp_pdf_cleanup(
  p_job_id text,
  p_lease_token text,
  p_target_status text,
  p_cleanup_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.temp_pdf_conversion_jobs%rowtype;
  v_new_attempts integer;
  v_final_status text;
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'service_role permission required');
  end if;

  if p_job_id is null or p_lease_token is null or trim(p_lease_token) = '' then
    return jsonb_build_object('success', false, 'error', 'INVALID_PARAMETERS');
  end if;

  select * into v_job
  from public.temp_pdf_conversion_jobs
  where job_id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND');
  end if;

  if v_job.lease_token is distinct from p_lease_token then
    return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN');
  end if;

  if v_job.status <> 'cleaning' then
    return jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_job.status);
  end if;

  v_new_attempts := coalesce(v_job.cleanup_attempts, 0) + 1;
  v_final_status := coalesce(p_target_status, 'cleaned');
  if v_final_status = 'failed' and v_new_attempts >= 5 then
    v_final_status := 'quarantined';
  end if;

  update public.temp_pdf_conversion_jobs
  set status = v_final_status,
      cleanup_attempts = v_new_attempts,
      cleanup_error = p_cleanup_error,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where job_id = p_job_id
    and lease_token = p_lease_token
    and status = 'cleaning';

  return jsonb_build_object(
    'success', true,
    'job_id', p_job_id,
    'status', v_final_status,
    'cleanup_attempts', v_new_attempts
  );
end;
$$;

revoke all on function public.finalize_temp_pdf_cleanup(text, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_temp_pdf_cleanup(text, text, text, text) to service_role;

