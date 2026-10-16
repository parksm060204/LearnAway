-- Migration 20260101000023: Independent Username Accounts and Hardened Trial Credits v2
--
-- 1. Table username_accounts: Maps normalized usernames to unique Supabase Auth UIDs.
-- 2. Table auth_rate_limits: Persistent server-side rate limiter for signup and login.
-- 3. Update ai_trial_credits default to 1 for new accounts (preserving existing 3-credit accounts).
-- 4. Harden ai_trial_reservations: lease/fencing, cached_result, and strict RPC permissions (service_role only).

-- 1. Username Accounts Mapping Table
create table if not exists public.username_accounts (
  username text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.username_accounts enable row level security;
revoke all on public.username_accounts from public, anon, authenticated;
grant select on public.username_accounts to authenticated;

drop policy if exists username_accounts_select_own on public.username_accounts;
create policy username_accounts_select_own on public.username_accounts
  for select using (auth.uid() = user_id);

-- 2. Persistent Auth Rate Limits Table & Atomic Function
create table if not exists public.auth_rate_limits (
  key text primary key,
  attempts integer not null default 1,
  window_start timestamptz not null default now()
);

alter table public.auth_rate_limits enable row level security;
revoke all on public.auth_rate_limits from public, anon, authenticated;

create or replace function public.check_and_increment_rate_limit(
  p_key text,
  p_max_attempts integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.auth_rate_limits%rowtype;
  v_now timestamptz := now();
  v_allowed boolean;
begin
  select * into v_rec
  from public.auth_rate_limits
  where key = p_key
  for update;

  if not found then
    insert into public.auth_rate_limits (key, attempts, window_start)
    values (p_key, 1, v_now);
    return true;
  end if;

  if v_now - v_rec.window_start > (p_window_seconds || ' seconds')::interval then
    update public.auth_rate_limits
    set attempts = 1, window_start = v_now
    where key = p_key;
    return true;
  else
    if v_rec.attempts >= p_max_attempts then
      return false;
    else
      update public.auth_rate_limits
      set attempts = attempts + 1
      where key = p_key;
      return true;
    end if;
  end if;
end;
$$;

revoke execute on function public.check_and_increment_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_and_increment_rate_limit(text, integer, integer) to service_role;

-- 3. Enhance ai_trial_reservations for lease/fencing and caching
alter table public.ai_trial_reservations
  add column if not exists lease_expires_at timestamptz,
  add column if not exists cached_result jsonb,
  add column if not exists error_code text;

-- Update status check constraint if possible
alter table public.ai_trial_reservations
  drop constraint if exists ai_trial_reservations_status_check;

alter table public.ai_trial_reservations
  add constraint ai_trial_reservations_status_check
  check (status in ('reserved', 'processing', 'result_ready', 'settled', 'released', 'failed_refunded', 'uncertain_timeout'));

-- 4. Update get_or_create_trial_credits to grant 1 credit for new users (preserving existing accounts)
create or replace function public.get_or_create_trial_credits()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_granted integer;
  v_balance integer;
  v_has_key boolean := false;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  -- New users receive 1 credit by default (existing rows are untouched due to ON CONFLICT DO NOTHING)
  insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
  values (v_uid, 1, 1, now(), now())
  on conflict (user_id) do nothing;

  select granted_credits, balance into v_granted, v_balance
  from public.ai_trial_credits
  where user_id = v_uid;

  select exists(
    select 1 from public.ai_connections
    where user_id = v_uid and status = 'connected' and api_key_ciphertext is not null and api_key_ciphertext <> ''
  ) into v_has_key;

  return jsonb_build_object(
    'granted', coalesce(v_granted, 1),
    'balance', coalesce(v_balance, 0),
    'hasPersonalKey', v_has_key
  );
end;
$$;

-- 5. Hardened reserve_trial_credit with lease, input verification, and server daily cap
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
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'error_code', 'UNAUTHENTICATED', 'message', '인증이 필요합니다.');
  end if;
  if auth.role() <> 'service_role' and auth.uid() is distinct from v_uid then
    return jsonb_build_object('allowed', false, 'error_code', 'FORBIDDEN', 'message', '권한이 없습니다.');
  end if;

  if coalesce(p_task_id, '') = '' or coalesce(p_task_type, '') = '' or coalesce(p_input_identifier, '') = '' then
    return jsonb_build_object('allowed', false, 'error_code', 'INVALID_PARAMETERS', 'message', '작업 식별 정보가 누락되었습니다.');
  end if;

  if p_task_type not in ('analyze_concepts', 'generate_problems', 'evaluate_answer') then
    return jsonb_build_object('allowed', false, 'error_code', 'UNSUPPORTED_TASK_TYPE', 'message', '체험 크레딧 대상 작업이 아닙니다.');
  end if;

  -- 1. Check existing reservation for idempotency, lease, and result caching
  select * into v_existing from public.ai_trial_reservations where task_id = p_task_id;
  if found then
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

    -- If already completed (result_ready or settled), DO NOT call AI again!
    if v_existing.status in ('settled', 'result_ready') then
      return jsonb_build_object(
        'allowed', false,
        'status', 'already_completed',
        'remaining', coalesce(v_balance, 0),
        'cached_result', v_existing.cached_result
      );
    end if;

    -- If currently processing and lease has not expired, block concurrent duplicate execution
    if v_existing.status = 'processing' and v_existing.lease_expires_at is not null and v_existing.lease_expires_at > now() then
      return jsonb_build_object(
        'allowed', false,
        'status', 'concurrent_in_progress',
        'error_code', 'CONCURRENT_EXECUTION_BLOCKED',
        'message', '동일한 작업이 현재 실행 중입니다. 잠시 후 결과를 확인해 주세요.'
      );
    end if;

    -- If attempt count exceeded limit
    if v_existing.attempt_count >= 3 then
      return jsonb_build_object('allowed', false, 'error_code', 'TASK_ATTEMPT_LIMIT_EXCEEDED', 'message', '동일 작업의 최대 재시도 한도(3회)를 초과했습니다.');
    end if;

    -- Re-acquire lease for retry
    update public.ai_trial_reservations
    set status = 'processing',
        attempt_count = attempt_count + 1,
        lease_expires_at = now() + interval '60 seconds',
        released_at = null,
        release_reason = null
    where task_id = p_task_id;

    return jsonb_build_object(
      'allowed', true,
      'status', 'processing',
      'remaining', coalesce(v_balance, 0)
    );
  end if;

  -- 2. Ensure user row exists with 1 credit default & lock row
  insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
  values (v_uid, 1, 1, now(), now())
  on conflict (user_id) do nothing;

  select balance, granted_credits into v_balance, v_granted
  from public.ai_trial_credits
  where user_id = v_uid
  for update;

  if v_balance <= 0 then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'INSUFFICIENT_CREDITS',
      'remaining', 0,
      'message', 'AI 체험 크레딧이 모두 소진되었습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.'
    );
  end if;

  -- 3. Check operator daily cap
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

  -- 4. Deduct 1 credit atomically
  update public.ai_trial_credits
  set balance = balance - 1, updated_at = now()
  where user_id = v_uid;

  -- 5. Record reservation with processing status and 60-second lease
  insert into public.ai_trial_reservations (
    task_id, user_id, task_type, input_identifier, status, attempt_count, lease_expires_at, created_at
  ) values (
    p_task_id, v_uid, p_task_type, p_input_identifier, 'processing', 1, now() + interval '60 seconds', now()
  );

  return jsonb_build_object(
    'allowed', true,
    'status', 'processing',
    'remaining', v_balance - 1
  );
end;
$$;

-- 6. RPC: Record Trial Result Ready (Saves AI output before DB persistence)
create or replace function public.record_trial_result_ready(
  p_task_id text,
  p_result jsonb,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_existing public.ai_trial_reservations%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error_code', 'UNAUTHENTICATED');
  end if;
  if auth.role() <> 'service_role' and auth.uid() is distinct from v_uid then
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN');
  end if;

  select * into v_existing from public.ai_trial_reservations where task_id = p_task_id;
  if not found or v_existing.user_id <> v_uid then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
  end if;

  update public.ai_trial_reservations
  set status = 'result_ready',
      cached_result = p_result,
      lease_expires_at = null
  where task_id = p_task_id;

  return jsonb_build_object('success', true, 'status', 'result_ready');
end;
$$;

-- 7. Hardened settle_trial_credit (service_role only)
create or replace function public.settle_trial_credit(
  p_task_id text,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_existing public.ai_trial_reservations%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error_code', 'UNAUTHENTICATED');
  end if;
  if auth.role() <> 'service_role' and auth.uid() is distinct from v_uid then
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN');
  end if;

  select * into v_existing
  from public.ai_trial_reservations
  where task_id = p_task_id;

  if not found or v_existing.user_id <> v_uid then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'message', '예약 내역을 찾을 수 없습니다.');
  end if;

  if v_existing.status = 'settled' then
    return jsonb_build_object('success', true, 'status', 'already_settled');
  end if;

  if v_existing.status not in ('processing', 'reserved', 'result_ready') then
    return jsonb_build_object('success', false, 'error_code', 'NOT_SETTLEABLE', 'message', '확정 가능한 상태가 아닙니다.');
  end if;

  update public.ai_trial_reservations
  set status = 'settled', settled_at = now(), lease_expires_at = null
  where task_id = p_task_id;

  return jsonb_build_object('success', true, 'status', 'settled');
end;
$$;

-- 8. Hardened release_trial_credit (service_role only)
create or replace function public.release_trial_credit(
  p_task_id text,
  p_reason text default null,
  p_user_id uuid default null
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
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error_code', 'UNAUTHENTICATED');
  end if;
  if auth.role() <> 'service_role' and auth.uid() is distinct from v_uid then
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN');
  end if;

  select * into v_existing
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found or v_existing.user_id <> v_uid then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'message', '예약 내역을 찾을 수 없습니다.');
  end if;

  if v_existing.status = 'settled' then
    return jsonb_build_object('success', false, 'error_code', 'ALREADY_SETTLED', 'message', '이미 정상 완료된 작업은 취소/환급할 수 없습니다.');
  end if;

  if v_existing.status in ('released', 'failed_refunded') then
    return jsonb_build_object('success', true, 'status', 'already_released');
  end if;

  -- Restore credit to balance (up to granted_credits)
  update public.ai_trial_credits
  set balance = least(balance + 1, granted_credits), updated_at = now()
  where user_id = v_uid
  returning balance into v_balance;

  update public.ai_trial_reservations
  set status = 'released',
      released_at = now(),
      lease_expires_at = null,
      release_reason = coalesce(p_reason, 'cancelled_or_failed')
  where task_id = p_task_id;

  return jsonb_build_object('success', true, 'status', 'released', 'remaining', v_balance);
end;
$$;

-- 9. STRICT PERMISSIONS: Revoke public and authenticated from execution; grant only to service_role!
revoke execute on function public.reserve_trial_credit(text, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_trial_credit(text, text, text, uuid, integer) to service_role;

revoke execute on function public.record_trial_result_ready(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_trial_result_ready(text, jsonb, uuid) to service_role;

revoke execute on function public.settle_trial_credit(text, uuid) from public, anon, authenticated;
grant execute on function public.settle_trial_credit(text, uuid) to service_role;

revoke execute on function public.release_trial_credit(text, text, uuid) from public, anon, authenticated;
grant execute on function public.release_trial_credit(text, text, uuid) to service_role;

-- Allow authenticated users to view their credits balance via get_or_create_trial_credits
grant execute on function public.get_or_create_trial_credits() to authenticated, service_role;
