-- ============================================================================
-- Migration 25: AI Trial Credits Hardening (V3) & Temporary PDF Lifecycle Tracking
--
-- 1. Drops legacy 4-argument reserve_trial_credit(text, text, text, uuid)
--    and revokes all permissions from public, anon, and authenticated.
-- 2. Enhances ai_trial_reservations with fencing tokens (lease_token)
--    to prevent stale execution callbacks from overwriting new state.
-- 3. Atomically verifies user balance, deducts credits on retrying refunded tasks,
--    and applies operator daily call limits to all AI attempts.
-- 4. Establishes strict service_role execution for reservation, result caching,
--    settlement, and refund RPCs.
-- 5. Implements temp_pdf_conversion_jobs tracking table for transient PDF
--    lifecycle management and idempotent scheduled cleanups.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Clean up legacy 4-argument reserve_trial_credit overload
-- ----------------------------------------------------------------------------
revoke execute on function public.reserve_trial_credit(text, text, text, uuid) from public, anon, authenticated;
drop function if exists public.reserve_trial_credit(text, text, text, uuid);

-- ----------------------------------------------------------------------------
-- 2. Schema enhancement for fencing tokens in ai_trial_reservations
-- ----------------------------------------------------------------------------
alter table public.ai_trial_reservations
  add column if not exists lease_token text;

-- ----------------------------------------------------------------------------
-- 3. Hardened reserve_trial_credit with fencing token & retry balance re-check
-- ----------------------------------------------------------------------------
create or replace function public.reserve_trial_credit(
  p_task_id text,
  p_task_type text,
  p_input_identifier text,
  p_user_id uuid default null,
  p_daily_cap integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_existing public.ai_trial_reservations%rowtype;
  v_balance integer;
  v_granted integer;
  v_daily_count integer;
  v_cap integer := coalesce(p_daily_cap, 500);
  v_lease_token text;
begin
  -- 1. Enforce server-only execution (service_role required)
  if auth.role() <> 'service_role' then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'FORBIDDEN',
      'message', '체험 크레딧 예약은 서버 전용 권한(service_role)이 필요합니다.'
    );
  end if;

  if v_uid is null then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'UNAUTHENTICATED',
      'message', '인증이 필요합니다.'
    );
  end if;

  if coalesce(p_task_id, '') = '' or coalesce(p_task_type, '') = '' or coalesce(p_input_identifier, '') = '' then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'INVALID_PARAMETERS',
      'message', '작업 식별 정보가 누락되었습니다.'
    );
  end if;

  if p_task_type not in ('analyze_concepts', 'generate_problems', 'evaluate_answer') then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'UNSUPPORTED_TASK_TYPE',
      'message', '체험 크레딧 대상 작업이 아닙니다.'
    );
  end if;

  -- 2. Consistent lock ordering: lock reservation row first
  select * into v_existing
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if found then
    -- Verify ownership & input identity
    if v_existing.user_id <> v_uid then
      return jsonb_build_object('allowed', false, 'error_code', 'TASK_OWNERSHIP_MISMATCH', 'message', '다른 사용자의 작업 식별자입니다.');
    end if;
    if v_existing.task_type <> p_task_type then
      return jsonb_build_object('allowed', false, 'error_code', 'TASK_TYPE_MISMATCH', 'message', '작업 종류가 일치하지 않습니다.');
    end if;
    if v_existing.input_identifier <> p_input_identifier then
      return jsonb_build_object('allowed', false, 'error_code', 'TASK_INPUT_MISMATCH', 'message', '기존 작업의 입력과 다른 입력으로 동일 작업 ID를 재사용할 수 없습니다.');
    end if;

    select balance into v_balance from public.ai_trial_credits where user_id = v_uid;

    -- If already completed, DO NOT call AI again!
    if v_existing.status in ('settled', 'result_ready') then
      return jsonb_build_object(
        'allowed', false,
        'status', 'already_completed',
        'remaining', coalesce(v_balance, 0),
        'cached_result', v_existing.cached_result,
        'message', '이미 완료된 작업의 결과가 보존되어 있습니다.'
      );
    end if;

    -- If currently processing and lease has not expired, block concurrent duplicate execution
    if v_existing.status = 'processing' and v_existing.lease_expires_at is not null and v_existing.lease_expires_at > now() then
      return jsonb_build_object(
        'allowed', false,
        'status', 'concurrent_in_progress',
        'remaining', coalesce(v_balance, 0),
        'message', '동일한 작업이 현재 실행 중입니다. 잠시 후 결과를 확인해 주세요.'
      );
    end if;

    -- Check maximum retry limit
    if v_existing.attempt_count >= 3 then
      return jsonb_build_object('allowed', false, 'error_code', 'TASK_ATTEMPT_LIMIT_EXCEEDED', 'message', '동일 작업의 최대 재시도 한도(3회)를 초과했습니다.');
    end if;

    -- If previously refunded (released), we MUST atomically verify balance and re-deduct 1 credit!
    if v_existing.status in ('released', 'failed_refunded') then
      select balance into v_balance
      from public.ai_trial_credits
      where user_id = v_uid
      for update;

      if coalesce(v_balance, 0) <= 0 then
        return jsonb_build_object(
          'allowed', false,
          'error_code', 'INSUFFICIENT_CREDITS',
          'remaining', 0,
          'message', 'AI 체험 크레딧이 모두 소진되었습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.'
        );
      end if;

      -- Check and increment operator daily cap for this new external AI call
      insert into public.operator_ai_daily_usage (usage_date, call_count)
      values (current_date, 1)
      on conflict (usage_date) do update set
        call_count = public.operator_ai_daily_usage.call_count + 1
      returning call_count into v_daily_count;

      if v_daily_count > v_cap then
        update public.operator_ai_daily_usage set call_count = call_count - 1 where usage_date = current_date;
        return jsonb_build_object(
          'allowed', false,
          'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
          'message', '금일 운영자 AI 체험 제공 한도가 모두 소진되었습니다. 내일 다시 시도하거나 개인 API 키를 등록해 주세요.'
        );
      end if;

      -- Re-deduct 1 credit atomically
      update public.ai_trial_credits
      set balance = balance - 1, updated_at = now()
      where user_id = v_uid;
      v_balance := v_balance - 1;
    else
      -- Credit was already held from an unrefunded attempt (e.g. expired processing lease).
      -- Do not double-deduct from user balance, but still check and count operator daily call.
      insert into public.operator_ai_daily_usage (usage_date, call_count)
      values (current_date, 1)
      on conflict (usage_date) do update set
        call_count = public.operator_ai_daily_usage.call_count + 1
      returning call_count into v_daily_count;

      if v_daily_count > v_cap then
        update public.operator_ai_daily_usage set call_count = call_count - 1 where usage_date = current_date;
        return jsonb_build_object(
          'allowed', false,
          'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
          'message', '금일 운영자 AI 체험 제공 한도가 모두 소진되었습니다. 내일 다시 시도하거나 개인 API 키를 등록해 주세요.'
        );
      end if;
    end if;

    -- Issue a fresh fencing lease token
    v_lease_token := 'lt_' || replace(gen_random_uuid()::text, '-', '');

    update public.ai_trial_reservations
    set status = 'processing',
        lease_token = v_lease_token,
        attempt_count = attempt_count + 1,
        lease_expires_at = now() + interval '60 seconds',
        released_at = null,
        release_reason = null,
        error_code = null
    where task_id = p_task_id;

    return jsonb_build_object(
      'allowed', true,
      'status', 'processing',
      'remaining', coalesce(v_balance, 0),
      'lease_token', v_lease_token
    );
  end if;

  -- 3. First-time reservation: lock user credit row second
  insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
  values (v_uid, 1, 1, now(), now())
  on conflict (user_id) do nothing;

  select balance, granted_credits into v_balance, v_granted
  from public.ai_trial_credits
  where user_id = v_uid
  for update;

  if coalesce(v_balance, 0) <= 0 then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'INSUFFICIENT_CREDITS',
      'remaining', 0,
      'message', 'AI 체험 크레딧이 모두 소진되었습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.'
    );
  end if;

  -- Check operator daily cap
  insert into public.operator_ai_daily_usage (usage_date, call_count)
  values (current_date, 1)
  on conflict (usage_date) do update set
    call_count = public.operator_ai_daily_usage.call_count + 1
  returning call_count into v_daily_count;

  if v_daily_count > v_cap then
    update public.operator_ai_daily_usage set call_count = call_count - 1 where usage_date = current_date;
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
      'message', '금일 운영자 AI 체험 제공 한도가 모두 소진되었습니다. 내일 다시 시도하거나 개인 API 키를 등록해 주세요.'
    );
  end if;

  -- Deduct 1 credit atomically
  update public.ai_trial_credits
  set balance = balance - 1, updated_at = now()
  where user_id = v_uid;

  -- Generate initial fencing token
  v_lease_token := 'lt_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.ai_trial_reservations (
    task_id, user_id, task_type, input_identifier, status, attempt_count, lease_token, lease_expires_at, created_at
  ) values (
    p_task_id, v_uid, p_task_type, p_input_identifier, 'processing', 1, v_lease_token, now() + interval '60 seconds', now()
  );

  return jsonb_build_object(
    'allowed', true,
    'status', 'processing',
    'remaining', v_balance - 1,
    'lease_token', v_lease_token
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Hardened record_trial_result_ready with fencing token verification
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
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('success', false, 'error', '권한이 없습니다 (service_role 전용).');
  end if;

  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', '예약 내역을 찾을 수 없습니다.');
  end if;
  if v_res.user_id <> v_uid then
    return jsonb_build_object('success', false, 'error', '사용자 소유권이 일치하지 않습니다.');
  end if;

  -- Fencing token validation: Reject stale executions from writing results
  if p_lease_token is not null and v_res.lease_token is not null and v_res.lease_token <> p_lease_token then
    return jsonb_build_object(
      'success', false,
      'error', '만료되었거나 유효하지 않은 실행 토큰(fencing token)입니다.',
      'error_code', 'STALE_LEASE_TOKEN'
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
-- 5. Hardened settle_trial_credit with fencing token verification
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
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('success', false, 'message', '권한이 없습니다 (service_role 전용).');
  end if;

  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '예약 내역을 찾을 수 없습니다.');
  end if;
  if v_res.user_id <> v_uid then
    return jsonb_build_object('success', false, 'message', '사용자 소유권이 일치하지 않습니다.');
  end if;

  -- Fencing token validation: Reject stale executions
  if p_lease_token is not null and v_res.lease_token is not null and v_res.lease_token <> p_lease_token then
    return jsonb_build_object(
      'success', false,
      'message', '만료되었거나 유효하지 않은 실행 토큰입니다.',
      'error_code', 'STALE_LEASE_TOKEN'
    );
  end if;

  if v_res.status = 'settled' then
    return jsonb_build_object('success', true, 'status', 'settled');
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
-- 6. Hardened release_trial_credit with fencing token & double-refund prevention
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
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('success', false, 'message', '권한이 없습니다 (service_role 전용).');
  end if;

  -- Consistent locking order: lock reservation row first
  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '예약 내역을 찾을 수 없습니다.');
  end if;
  if v_res.user_id <> v_uid then
    return jsonb_build_object('success', false, 'message', '사용자 소유권이 일치하지 않습니다.');
  end if;

  -- Fencing token check: Stale execution cannot refund or mutate state!
  if p_lease_token is not null and v_res.lease_token is not null and v_res.lease_token <> p_lease_token then
    return jsonb_build_object(
      'success', false,
      'message', '만료되었거나 유효하지 않은 실행 토큰입니다.',
      'error_code', 'STALE_LEASE_TOKEN'
    );
  end if;

  -- If already settled, CANNOT refund!
  if v_res.status = 'settled' then
    return jsonb_build_object('success', false, 'message', '이미 확정된 작업은 환급할 수 없습니다.');
  end if;

  -- If already released/refunded, idempotent return without double refund
  if v_res.status in ('released', 'failed_refunded') then
    select balance into v_new_balance from public.ai_trial_credits where user_id = v_uid;
    return jsonb_build_object('success', true, 'status', v_res.status, 'remaining', coalesce(v_new_balance, 0));
  end if;

  -- Consistent locking order: lock user credit row second
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

  return jsonb_build_object('success', true, 'status', 'released', 'remaining', v_new_balance);
end;
$$;

-- Enforce strict service_role permissions on all reservation management RPCs
revoke all on function public.reserve_trial_credit(text, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_trial_credit(text, text, text, uuid, integer) to service_role;

revoke all on function public.record_trial_result_ready(text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.record_trial_result_ready(text, jsonb, uuid, text) to service_role;

revoke all on function public.settle_trial_credit(text, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_trial_credit(text, uuid, text) to service_role;

revoke all on function public.release_trial_credit(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.release_trial_credit(text, text, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Temporary PDF Conversion Jobs Ledger Table & Cleanup RPC
-- ----------------------------------------------------------------------------
create table if not exists public.temp_pdf_conversion_jobs (
  job_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size bigint not null default 0,
  status text not null default 'ticket_issued' check (status in ('ticket_issued', 'uploaded', 'converting', 'completed', 'failed', 'cancelled', 'cleaned')),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  cleanup_attempts integer not null default 0,
  cleanup_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists temp_pdf_jobs_user_idx on public.temp_pdf_conversion_jobs(user_id);
create index if not exists temp_pdf_jobs_expires_idx on public.temp_pdf_conversion_jobs(expires_at, status);

alter table public.temp_pdf_conversion_jobs enable row level security;
revoke all on public.temp_pdf_conversion_jobs from public, anon, authenticated;
grant select, insert, update on public.temp_pdf_conversion_jobs to authenticated;
grant all on public.temp_pdf_conversion_jobs to service_role;

drop policy if exists temp_pdf_jobs_owner_policy on public.temp_pdf_conversion_jobs;
create policy temp_pdf_jobs_owner_policy on public.temp_pdf_conversion_jobs
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RPC for scheduled cleanup query (service_role only)
create or replace function public.get_expired_temp_pdf_jobs(
  p_limit integer default 50
)
returns setof public.temp_pdf_conversion_jobs
language sql
security definer
set search_path = public
as $$
  select *
  from public.temp_pdf_conversion_jobs
  where expires_at < now()
    and status not in ('cleaned', 'converting')
  order by expires_at asc
  limit coalesce(p_limit, 50);
$$;

revoke all on function public.get_expired_temp_pdf_jobs(integer) from public, anon, authenticated;
grant execute on function public.get_expired_temp_pdf_jobs(integer) to service_role;
