-- Migration 20260101000022: Account-level AI Trial Credits (3 Free Experiences)
--
-- 1. Table ai_trial_credits: Tracks one-time 3-credit grant and current balance per user.
-- 2. Table ai_trial_reservations: Atomic reservation & idempotency ledger for AI tasks.
-- 3. Table operator_ai_daily_usage: Enforces daily operator API call limit.
-- 4. RLS & Security Definer RPCs: Prevent direct client manipulation, cross-user access,
--    and race conditions on concurrent requests.

-- 1. User Trial Credits Table
create table if not exists public.ai_trial_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_credits integer not null default 3 check (granted_credits >= 0),
  balance integer not null default 3 check (balance >= 0 and balance <= granted_credits),
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_trial_credits enable row level security;
revoke all on public.ai_trial_credits from public, anon, authenticated;
grant select on public.ai_trial_credits to authenticated;

drop policy if exists ai_trial_credits_select_own on public.ai_trial_credits;
create policy ai_trial_credits_select_own on public.ai_trial_credits
  for select using (auth.uid() = user_id);

-- 2. Task Reservation Ledger Table
create table if not exists public.ai_trial_reservations (
  task_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_type text not null check (task_type in ('analyze_concepts', 'generate_problems', 'evaluate_answer')),
  input_identifier text not null,
  status text not null check (status in ('reserved', 'settled', 'released', 'failed_refunded')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  released_at timestamptz,
  release_reason text
);

create index if not exists ai_trial_reservations_user_idx
  on public.ai_trial_reservations (user_id);

alter table public.ai_trial_reservations enable row level security;
revoke all on public.ai_trial_reservations from public, anon, authenticated;
grant select on public.ai_trial_reservations to authenticated;

drop policy if exists ai_trial_reservations_select_own on public.ai_trial_reservations;
create policy ai_trial_reservations_select_own on public.ai_trial_reservations
  for select using (auth.uid() = user_id);

-- 3. Daily Operator Usage Table
create table if not exists public.operator_ai_daily_usage (
  usage_date date primary key default current_date,
  call_count integer not null default 0 check (call_count >= 0)
);

alter table public.operator_ai_daily_usage enable row level security;
revoke all on public.operator_ai_daily_usage from public, anon, authenticated;

-- 4. RPC: Get or Create Trial Credits for Authenticated User
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

  insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
  values (v_uid, 3, 3, now(), now())
  on conflict (user_id) do nothing;

  select granted_credits, balance into v_granted, v_balance
  from public.ai_trial_credits
  where user_id = v_uid;

  select exists(
    select 1 from public.ai_connections
    where user_id = v_uid and status = 'connected' and api_key_ciphertext is not null and api_key_ciphertext <> ''
  ) into v_has_key;

  return jsonb_build_object(
    'granted', coalesce(v_granted, 3),
    'balance', coalesce(v_balance, 0),
    'hasPersonalKey', v_has_key
  );
end;
$$;

-- 5. RPC: Reserve Trial Credit (Atomic & Idempotent)
create or replace function public.reserve_trial_credit(
  p_task_id text,
  p_task_type text,
  p_input_identifier text,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(auth.uid(), p_user_id);
  v_existing public.ai_trial_reservations%rowtype;
  v_balance integer;
  v_granted integer;
  v_daily_count integer;
  v_daily_cap constant integer := 500;
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

  -- 1. Check existing reservation for idempotency & input binding
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

    if v_existing.status = 'settled' then
      return jsonb_build_object('allowed', true, 'status', 'already_settled', 'remaining', coalesce(v_balance, 0));
    elsif v_existing.status = 'reserved' then
      return jsonb_build_object('allowed', true, 'status', 'already_reserved', 'remaining', coalesce(v_balance, 0));
    elsif v_existing.status in ('released', 'failed_refunded') then
      if v_existing.attempt_count >= 3 then
        return jsonb_build_object('allowed', false, 'error_code', 'TASK_ATTEMPT_LIMIT_EXCEEDED', 'message', '동일 작업의 최대 재시도 한도(3회)를 초과했습니다.');
      end if;
    end if;
  end if;

  -- 2. Ensure user row exists & lock row
  insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
  values (v_uid, 3, 3, now(), now())
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
      'message', 'AI 체험 크레딧(3회)이 모두 소진되었습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.'
    );
  end if;

  -- 3. Check operator daily cap
  insert into public.operator_ai_daily_usage (usage_date, call_count)
  values (current_date, 1)
  on conflict (usage_date) do update set
    call_count = public.operator_ai_daily_usage.call_count + 1
  returning call_count into v_daily_count;

  if v_daily_count > v_daily_cap then
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

  -- 5. Record reservation
  if found and v_existing.task_id is not null then
    update public.ai_trial_reservations
    set status = 'reserved',
        attempt_count = attempt_count + 1,
        released_at = null,
        release_reason = null
    where task_id = p_task_id;
  else
    insert into public.ai_trial_reservations (
      task_id, user_id, task_type, input_identifier, status, attempt_count, created_at
    ) values (
      p_task_id, v_uid, p_task_type, p_input_identifier, 'reserved', 1, now()
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'status', 'reserved',
    'remaining', v_balance - 1
  );
end;
$$;

-- 6. RPC: Settle Trial Credit
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
  v_uid uuid := coalesce(auth.uid(), p_user_id);
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

  if v_existing.status <> 'reserved' then
    return jsonb_build_object('success', false, 'error_code', 'NOT_RESERVED', 'message', '예약 상태가 아니므로 확정할 수 없습니다.');
  end if;

  update public.ai_trial_reservations
  set status = 'settled', settled_at = now()
  where task_id = p_task_id;

  return jsonb_build_object('success', true, 'status', 'settled');
end;
$$;

-- 7. RPC: Release Trial Credit (Refund back to balance)
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
  v_uid uuid := coalesce(auth.uid(), p_user_id);
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
      release_reason = coalesce(p_reason, 'cancelled_or_failed')
  where task_id = p_task_id;

  return jsonb_build_object('success', true, 'status', 'released', 'remaining', v_balance);
end;
$$;

revoke execute on function public.get_or_create_trial_credits() from public, anon;
grant execute on function public.get_or_create_trial_credits() to authenticated, service_role;

revoke execute on function public.reserve_trial_credit(text, text, text, uuid) from public, anon;
grant execute on function public.reserve_trial_credit(text, text, text, uuid) to authenticated, service_role;

revoke execute on function public.settle_trial_credit(text, uuid) from public, anon;
grant execute on function public.settle_trial_credit(text, uuid) to authenticated, service_role;

revoke execute on function public.release_trial_credit(text, text, uuid) from public, anon;
grant execute on function public.release_trial_credit(text, text, uuid) to authenticated, service_role;
