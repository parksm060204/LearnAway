-- ============================================================================
-- Migration 28: Catchup Stabilization and Cleanup Atomicity for Existing DBs
--
-- Purpose:
-- 1. Ensure all schema additions (lease_token, lease_expires_at) exist safely on
--    temp_pdf_conversion_jobs and ai_trial_reservations for databases upgrading from
--    any prior version.
-- 2. Safely clean up legacy overloaded function signatures with exception handling.
-- 3. Provide canonical, single-source-of-truth trial credit functions
--    (determine_initial_trial_credits, get_or_create_trial_credits, reserve_trial_credit)
--    with the 42703 (updated_at) bug fixed and atomicity preserved.
-- 4. Provide complete atomic PDF conversion and cleanup lifecycle RPCs
--    (claim_expired_temp_pdf_jobs, claim_temp_pdf_job_for_conversion,
--     claim_temp_pdf_cleanup_by_converter, finalize_temp_pdf_cleanup).
-- 5. Lock down all execution permissions to service_role (and authenticated for
--    user credit status check).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema Idempotency: Columns and Indexes
-- ----------------------------------------------------------------------------
alter table if exists public.temp_pdf_conversion_jobs
  add column if not exists lease_token text,
  add column if not exists lease_expires_at timestamptz;

create index if not exists temp_pdf_conversion_jobs_lease_idx
  on public.temp_pdf_conversion_jobs (lease_expires_at);

alter table if exists public.ai_trial_reservations
  add column if not exists lease_token text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists cached_result jsonb,
  add column if not exists error_code text,
  add column if not exists updated_at timestamptz default now();

create index if not exists ai_trial_reservations_lease_idx
  on public.ai_trial_reservations (lease_expires_at);

-- ----------------------------------------------------------------------------
-- 2. Safe Legacy Overload Cleanups (Zero 42883 undefined_function errors)
-- ----------------------------------------------------------------------------
do $$
begin
  drop function if exists public.settle_trial_credit(text, uuid, text, jsonb);
  drop function if exists public.settle_trial_credit(text, uuid);
  drop function if exists public.release_trial_credit(text, text, uuid);
  drop function if exists public.record_trial_result_ready(text, jsonb, uuid);
  drop function if exists public.reserve_trial_credit(text, text, text, uuid, uuid);
exception
  when undefined_function then null;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Single Source of Truth: Account Tier & Initial Trial Credit Resolution
-- ----------------------------------------------------------------------------
create or replace function public.determine_initial_trial_credits(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_email text;
  v_auth_type text;
  v_is_username boolean := false;
begin
  if p_user_id is null then
    return 1;
  end if;

  select
    email,
    raw_user_meta_data->>'auth_type'
  into
    v_user_email,
    v_auth_type
  from auth.users
  where id = p_user_id;

  select exists (
    select 1
    from public.username_accounts
    where user_id = p_user_id
  ) into v_is_username;

  if v_is_username
     or coalesce(v_auth_type, '') = 'username'
     or coalesce(v_user_email, '') like '%@id.learnaway.local' then
    return 1;
  else
    return 3;
  end if;
end;
$$;

revoke all on function public.determine_initial_trial_credits(uuid) from public, anon, authenticated;
grant execute on function public.determine_initial_trial_credits(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Unified Trial Credit Query RPCs (Zero Mutation on Existing Balances)
-- ----------------------------------------------------------------------------
create or replace function public.get_or_create_trial_credits(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user uuid;
  v_row public.ai_trial_credits%rowtype;
  v_initial_grant integer;
  v_is_guest boolean;
begin
  if auth.role() = 'service_role' then
    v_target_user := p_user_id;
  else
    v_target_user := auth.uid();
  end if;

  if v_target_user is null then
    return jsonb_build_object(
      'granted', 0,
      'balance', 0,
      'isGuest', true,
      'isExhausted', true,
      'error', 'UNAUTHENTICATED'
    );
  end if;

  select * into v_row
  from public.ai_trial_credits
  where user_id = v_target_user
  for update;

  if not found then
    v_initial_grant := public.determine_initial_trial_credits(v_target_user);

    insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
    values (v_target_user, v_initial_grant, v_initial_grant, now(), now())
    on conflict (user_id) do nothing
    returning * into v_row;

    if v_row.user_id is null then
      select * into v_row
      from public.ai_trial_credits
      where user_id = v_target_user;
    end if;
  end if;

  v_is_guest := (v_row.granted_credits = 1);

  return jsonb_build_object(
    'granted', coalesce(v_row.granted_credits, 0),
    'balance', coalesce(v_row.balance, 0),
    'isGuest', v_is_guest,
    'isExhausted', coalesce(v_row.balance, 0) <= 0
  );
end;
$$;

create or replace function public.get_or_create_trial_credits()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.get_or_create_trial_credits(auth.uid());
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Canonical Atomic Reservation RPC (Anti-Race, Fencing, Fixed 42703)
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
  v_uid uuid;
  v_existing public.ai_trial_reservations%rowtype;
  v_balance integer;
  v_granted integer;
  v_initial_grant integer;
  v_daily_count integer;
  v_cap integer := coalesce(p_daily_cap, 500);
  v_lease_token text;
begin
  if auth.role() = 'service_role' then
    v_uid := coalesce(p_user_id, auth.uid());
  else
    v_uid := auth.uid();
  end if;

  if v_uid is null then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'UNAUTHENTICATED',
      'code', 'UNAUTHENTICATED',
      'error', 'UNAUTHENTICATED',
      'message', '인증된 사용자만 AI 체험을 이용할 수 있습니다.'
    );
  end if;

  if p_task_id is null or trim(p_task_id) = '' then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'INVALID_TASK_ID',
      'code', 'INVALID_TASK_ID',
      'error', 'INVALID_TASK_ID',
      'message', '유효한 작업 식별자가 필요합니다.'
    );
  end if;

  if p_task_type not in ('analyze_concepts', 'generate_problems', 'evaluate_answer') then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'INVALID_TASK_TYPE',
      'code', 'INVALID_TASK_TYPE',
      'error', 'INVALID_TASK_TYPE',
      'message', '지원하지 않는 작업 유형입니다.'
    );
  end if;

  -- 1. Check existing reservation for idempotency and state guards
  select * into v_existing
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if found then
    if v_existing.user_id <> v_uid then
      return jsonb_build_object(
        'allowed', false,
        'error_code', 'TASK_OWNERSHIP_MISMATCH',
        'code', 'TASK_OWNERSHIP_MISMATCH',
        'error', 'TASK_OWNERSHIP_MISMATCH',
        'message', '해당 작업에 대한 접근 권한이 없습니다.'
      );
    end if;

    if v_existing.task_type <> p_task_type or v_existing.input_identifier <> p_input_identifier then
      return jsonb_build_object(
        'allowed', false,
        'error_code', 'TASK_INPUT_MISMATCH',
        'code', 'TASK_INPUT_MISMATCH',
        'error', 'TASK_INPUT_MISMATCH',
        'message', '동일한 작업 ID에 서로 다른 입력이 전달되었습니다.'
      );
    end if;

    select balance into v_balance
    from public.ai_trial_credits
    where user_id = v_uid;

    -- If already finalized/settled, return preserved cached result immediately
    if v_existing.status = 'settled' then
      return jsonb_build_object(
        'allowed', false,
        'status', 'already_completed',
        'remaining', coalesce(v_balance, 0),
        'cached_result', v_existing.cached_result,
        'message', '이미 정상 완료된 작업입니다.'
      );
    end if;

    -- If AI result was already generated and preserved (result_ready or cached_result exists),
    -- NEVER invoke AI again regardless of lease expiration! Return preserved result immediately.
    if v_existing.status = 'result_ready' or v_existing.cached_result is not null then
      return jsonb_build_object(
        'allowed', false,
        'status', 'already_completed',
        'remaining', coalesce(v_balance, 0),
        'cached_result', v_existing.cached_result,
        'message', '이미 생성된 AI 결과가 보존되어 있습니다.'
      );
    end if;

    -- If currently in flight with an active lease, block duplicate concurrent execution
    if v_existing.status in ('reserved', 'processing')
       and v_existing.lease_expires_at is not null
       and v_existing.lease_expires_at > now() then
      return jsonb_build_object(
        'allowed', false,
        'status', 'concurrent_in_progress',
        'error_code', 'CONCURRENT_EXECUTION',
        'code', 'CONCURRENT_EXECUTION',
        'error', 'CONCURRENT_EXECUTION',
        'remaining', coalesce(v_balance, 0),
        'message', '동일한 작업이 현재 처리 중입니다.'
      );
    end if;

    -- Enforce maximum attempt limit (3 attempts)
    if v_existing.attempt_count >= 3 then
      return jsonb_build_object(
        'allowed', false,
        'error_code', 'MAX_ATTEMPTS_EXCEEDED',
        'code', 'MAX_ATTEMPTS_EXCEEDED',
        'error', 'MAX_ATTEMPTS_EXCEEDED',
        'remaining', coalesce(v_balance, 0),
        'message', '최대 재시도 횟수를 초과했습니다.'
      );
    end if;

    -- Re-check balance & deduct if previous attempt was released/refunded
    if v_existing.status in ('released', 'failed_refunded') then
      select balance into v_balance
      from public.ai_trial_credits
      where user_id = v_uid
      for update;

      if coalesce(v_balance, 0) <= 0 then
        return jsonb_build_object(
          'allowed', false,
          'error_code', 'INSUFFICIENT_CREDITS',
          'code', 'INSUFFICIENT_CREDITS',
          'error', 'INSUFFICIENT_CREDITS',
          'remaining', 0,
          'message', '체험 크레딧이 모두 소진되었습니다. 설정에서 개인 API 키를 등록해 주세요.'
        );
      end if;

      insert into public.operator_ai_daily_usage (usage_date, call_count)
      values (current_date, 1)
      on conflict (usage_date) do update set
        call_count = operator_ai_daily_usage.call_count + 1
      returning call_count into v_daily_count;

      if v_daily_count > v_cap then
        update public.operator_ai_daily_usage set call_count = call_count - 1 where usage_date = current_date;
        return jsonb_build_object(
          'allowed', false,
          'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
          'code', 'OPERATOR_DAILY_CAP_EXCEEDED',
          'error', 'OPERATOR_DAILY_CAP_EXCEEDED',
          'remaining', coalesce(v_balance, 0),
          'message', '오늘의 운영자 AI 체험 전체 한도가 마감되었습니다. 설정에서 개인 API 키를 등록해 주세요.'
        );
      end if;

      update public.ai_trial_credits
      set balance = balance - 1,
          updated_at = now()
      where user_id = v_uid
      returning balance into v_balance;
    else
      -- Expired lease without refund: balance was already held, but check and count operator daily call
      insert into public.operator_ai_daily_usage (usage_date, call_count)
      values (current_date, 1)
      on conflict (usage_date) do update set
        call_count = operator_ai_daily_usage.call_count + 1
      returning call_count into v_daily_count;

      if v_daily_count > v_cap then
        update public.operator_ai_daily_usage set call_count = call_count - 1 where usage_date = current_date;
        return jsonb_build_object(
          'allowed', false,
          'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
          'code', 'OPERATOR_DAILY_CAP_EXCEEDED',
          'error', 'OPERATOR_DAILY_CAP_EXCEEDED',
          'remaining', coalesce(v_balance, 0),
          'message', '오늘의 운영자 AI 체험 전체 한도가 마감되었습니다. 설정에서 개인 API 키를 등록해 주세요.'
        );
      end if;
    end if;

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

  -- 2. Brand new task reservation
  select balance, granted_credits into v_balance, v_granted
  from public.ai_trial_credits
  where user_id = v_uid
  for update;

  if not found then
    v_initial_grant := public.determine_initial_trial_credits(v_uid);

    insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
    values (v_uid, v_initial_grant, v_initial_grant, now(), now())
    on conflict (user_id) do nothing
    returning balance, granted_credits into v_balance, v_granted;

    if v_balance is null then
      select balance, granted_credits into v_balance, v_granted
      from public.ai_trial_credits
      where user_id = v_uid
      for update;
    end if;
  end if;

  if coalesce(v_balance, 0) <= 0 then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'INSUFFICIENT_CREDITS',
      'code', 'INSUFFICIENT_CREDITS',
      'error', 'INSUFFICIENT_CREDITS',
      'remaining', 0,
      'message', '체험 크레딧이 모두 소진되었습니다. 설정에서 개인 API 키를 등록해 주세요.'
    );
  end if;

  insert into public.operator_ai_daily_usage (usage_date, call_count)
  values (current_date, 1)
  on conflict (usage_date) do update set
    call_count = operator_ai_daily_usage.call_count + 1
  returning call_count into v_daily_count;

  if v_daily_count > v_cap then
    update public.operator_ai_daily_usage set call_count = call_count - 1 where usage_date = current_date;
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
      'code', 'OPERATOR_DAILY_CAP_EXCEEDED',
      'error', 'OPERATOR_DAILY_CAP_EXCEEDED',
      'remaining', coalesce(v_balance, 0),
      'message', '오늘의 운영자 AI 체험 전체 한도가 마감되었습니다. 설정에서 개인 API 키를 등록해 주세요.'
    );
  end if;

  -- Deduct 1 credit atomically
  update public.ai_trial_credits
  set balance = balance - 1,
      updated_at = now()
  where user_id = v_uid;

  v_lease_token := 'lt_' || replace(gen_random_uuid()::text, '-', '');

  -- INSERT WITHOUT updated_at column to guarantee compatibility across all schema revisions
  insert into public.ai_trial_reservations (
    task_id, user_id, task_type, input_identifier, status,
    attempt_count, lease_token, lease_expires_at, created_at
  ) values (
    p_task_id, v_uid, p_task_type, p_input_identifier, 'processing',
    1, v_lease_token, now() + interval '60 seconds', now()
  );

  return jsonb_build_object(
    'allowed', true,
    'status', 'reserved',
    'remaining', v_balance - 1,
    'lease_token', v_lease_token
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Canonical Settlement and Release RPCs (Fencing Token Enforced)
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
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'error_code', 'UNAUTHORIZED', 'message', 'service_role 권한이 필요합니다.');
  end if;

  if coalesce(p_task_id, '') = '' then
    return jsonb_build_object('success', false, 'error', 'INVALID_PARAMETERS', 'error_code', 'INVALID_PARAMETERS', 'message', '작업 식별자가 필요합니다.');
  end if;

  if v_token = '' then
    return jsonb_build_object('success', false, 'error', 'LEASE_TOKEN_REQUIRED', 'error_code', 'LEASE_TOKEN_REQUIRED', 'message', '유효한 실행 토큰(lease_token)이 필요합니다.');
  end if;

  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'RESERVATION_NOT_FOUND', 'error_code', 'RESERVATION_NOT_FOUND', 'message', '예약 내역을 찾을 수 없습니다.');
  end if;

  if v_res.user_id <> v_uid then
    return jsonb_build_object('success', false, 'error', 'TASK_OWNERSHIP_MISMATCH', 'error_code', 'TASK_OWNERSHIP_MISMATCH', 'message', '예약 소유자가 일치하지 않습니다.');
  end if;

  -- Fencing lease token verification
  if v_res.lease_token is null or v_res.lease_token <> v_token then
    return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN', 'message', '유효하지 않거나 만료된 실행 토큰입니다.');
  end if;

  -- Idempotency: already settled
  if v_res.status = 'settled' then
    return jsonb_build_object('success', true, 'status', 'settled', 'message', '이미 확정된 작업입니다.');
  end if;

  -- Refunded task guard
  if v_res.status in ('released', 'failed_refunded') then
    return jsonb_build_object('success', false, 'error', 'ALREADY_REFUNDED', 'error_code', 'ALREADY_REFUNDED', 'message', '이미 환급된 작업은 재차감 없이 확정할 수 없습니다.');
  end if;

  -- Cached result guard: cannot settle without preserved AI output
  if v_res.cached_result is null then
    return jsonb_build_object('success', false, 'error', 'MISSING_CACHED_RESULT', 'error_code', 'MISSING_CACHED_RESULT', 'message', '보존된 AI 결과가 없어 크레딧을 확정할 수 없습니다.');
  end if;

  update public.ai_trial_reservations
  set status = 'settled',
      settled_at = coalesce(settled_at, now()),
      lease_token = null,
      lease_expires_at = null
  where task_id = p_task_id
    and lease_token = v_token;

  -- NOTE: Do NOT duplicate operator_ai_daily_usage increment here.
  -- Daily usage is already counted during reserve_trial_credit.

  return jsonb_build_object('success', true, 'status', 'settled');
end;
$$;

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
  v_token text := trim(coalesce(p_lease_token, ''));
  v_new_balance integer;
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'error_code', 'UNAUTHORIZED', 'message', 'service_role 권한이 필요합니다.');
  end if;

  if coalesce(p_task_id, '') = '' then
    return jsonb_build_object('success', false, 'error', 'INVALID_PARAMETERS', 'error_code', 'INVALID_PARAMETERS', 'message', '작업 식별자가 필요합니다.');
  end if;

  if v_token = '' then
    return jsonb_build_object('success', false, 'error', 'LEASE_TOKEN_REQUIRED', 'error_code', 'LEASE_TOKEN_REQUIRED', 'message', '유효한 실행 토큰(lease_token)이 필요합니다.');
  end if;

  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'RESERVATION_NOT_FOUND', 'error_code', 'RESERVATION_NOT_FOUND', 'message', '예약 내역을 찾을 수 없습니다.');
  end if;

  if v_res.user_id <> v_uid then
    return jsonb_build_object('success', false, 'error', 'TASK_OWNERSHIP_MISMATCH', 'error_code', 'TASK_OWNERSHIP_MISMATCH', 'message', '예약 소유자가 일치하지 않습니다.');
  end if;

  -- Fencing token verification
  if v_res.lease_token is null or v_res.lease_token <> v_token then
    return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN', 'message', '유효하지 않거나 만료된 실행 토큰입니다.');
  end if;

  -- Settled task cannot be refunded
  if v_res.status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'ALREADY_SETTLED', 'error_code', 'ALREADY_SETTLED', 'message', '이미 확정된 작업은 환급할 수 없습니다.');
  end if;

  -- Idempotency: already released
  if v_res.status in ('released', 'failed_refunded') then
    select balance into v_new_balance from public.ai_trial_credits where user_id = v_uid;
    return jsonb_build_object(
      'success', true,
      'status', v_res.status,
      'refunded', false,
      'balance', coalesce(v_new_balance, 0),
      'remaining', coalesce(v_new_balance, 0),
      'message', '이미 완료되었거나 환급된 작업입니다.'
    );
  end if;

  -- Guard: Tasks with preserved AI results (result_ready or cached_result exists) MUST NOT be refunded.
  -- Downstream DB persistence failure should retry storage/settlement, NOT refund consumed AI tokens.
  if v_res.status = 'result_ready' or v_res.cached_result is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'CANNOT_REFUND_RESULT_READY',
      'error_code', 'CANNOT_REFUND_RESULT_READY',
      'message', '이미 AI 결과가 생성 및 보존된 작업은 환급할 수 없습니다. 결과 저장 및 정산을 재시도해 주세요.'
    );
  end if;

  -- Refund credit to user balance
  update public.ai_trial_reservations
  set status = 'failed_refunded',
      released_at = now(),
      release_reason = coalesce(p_reason, 'cancelled_or_failed'),
      lease_token = null,
      lease_expires_at = null
  where task_id = p_task_id
    and lease_token = v_token;

  update public.ai_trial_credits
  set balance = least(balance + 1, granted_credits),
      updated_at = now()
  where user_id = v_uid
  returning balance into v_new_balance;

  return jsonb_build_object(
    'success', true,
    'status', 'refunded',
    'refunded', true,
    'balance', v_new_balance,
    'remaining', v_new_balance
  );
end;
$$;

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
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'error_code', 'UNAUTHORIZED', 'message', 'service_role 권한이 필요합니다.');
  end if;

  if coalesce(p_task_id, '') = '' then
    return jsonb_build_object('success', false, 'error', 'INVALID_PARAMETERS', 'error_code', 'INVALID_PARAMETERS', 'message', '작업 식별자가 필요합니다.');
  end if;

  if v_token = '' then
    return jsonb_build_object('success', false, 'error', 'LEASE_TOKEN_REQUIRED', 'error_code', 'LEASE_TOKEN_REQUIRED', 'message', '유효한 실행 토큰(lease_token)이 필요합니다.');
  end if;

  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'RESERVATION_NOT_FOUND', 'error_code', 'RESERVATION_NOT_FOUND', 'message', '예약 내역을 찾을 수 없습니다.');
  end if;

  if v_res.user_id <> v_uid then
    return jsonb_build_object('success', false, 'error', 'TASK_OWNERSHIP_MISMATCH', 'error_code', 'TASK_OWNERSHIP_MISMATCH', 'message', '예약 소유자가 일치하지 않습니다.');
  end if;

  -- Fencing token verification
  if v_res.lease_token is null or v_res.lease_token <> v_token then
    return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN', 'message', '만료되었거나 유효하지 않은 실행 토큰(fencing token)입니다.');
  end if;

  -- Settled task cannot have result overwritten
  if v_res.status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'ALREADY_SETTLED', 'error_code', 'ALREADY_SETTLED', 'message', '이미 최종 확정된 작업의 결과는 덮어쓸 수 없습니다.');
  end if;

  -- Refunded task cannot record results
  if v_res.status in ('released', 'failed_refunded') then
    return jsonb_build_object('success', false, 'error', 'ALREADY_REFUNDED', 'error_code', 'ALREADY_REFUNDED', 'message', '이미 환급된 작업의 결과를 기록할 수 없습니다.');
  end if;

  -- Atomically preserve cached result AND transition status to 'result_ready'
  update public.ai_trial_reservations
  set cached_result = p_result,
      status = 'result_ready',
      lease_expires_at = now() + interval '300 seconds',
      error_code = null
  where task_id = p_task_id
    and lease_token = v_token;

  return jsonb_build_object('success', true, 'status', 'result_ready');
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. PDF Lifecycle RPCs: Claiming, Conversion, and Cleanup Atomicity
-- ----------------------------------------------------------------------------
create or replace function public.claim_expired_temp_pdf_jobs(
  p_limit integer default 20
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
      'code', 'STORAGE_ACCESS_DENIED',
      'error', 'service_role 권한이 필요합니다.'
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
      'error', '작업 내역을 찾을 수 없습니다.'
    );
  end if;

  if v_job.user_id <> p_user_id then
    return jsonb_build_object(
      'success', false,
      'code', 'STORAGE_ACCESS_DENIED',
      'error', '작업 접근 권한이 없습니다.'
    );
  end if;

  if v_job.status in ('cleaned', 'cleaning', 'quarantined', 'cancelled') then
    return jsonb_build_object(
      'success', false,
      'code', 'JOB_NOT_CONVERTIBLE',
      'status', v_job.status,
      'error', '해당 작업은 이미 정리 중이거나 종료되어 변환할 수 없습니다.'
    );
  end if;

  if v_job.expires_at <= now() then
    return jsonb_build_object(
      'success', false,
      'code', 'JOB_EXPIRED',
      'status', v_job.status,
      'error', '임시 파일 유효시간이 만료되었습니다.'
    );
  end if;

  if v_job.status = 'converting' and v_job.lease_expires_at is not null and v_job.lease_expires_at > now() then
    return jsonb_build_object(
      'success', false,
      'code', 'CONCURRENT_CONVERSION',
      'status', v_job.status,
      'error', '동일한 작업이 현재 변환 처리 중입니다.'
    );
  end if;

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

-- ----------------------------------------------------------------------------
-- 8. Explicit Execution Permissions Lockdown
-- ----------------------------------------------------------------------------
revoke all on function public.get_or_create_trial_credits() from public, anon;
grant execute on function public.get_or_create_trial_credits() to authenticated, service_role;

revoke all on function public.get_or_create_trial_credits(uuid) from public, anon;
grant execute on function public.get_or_create_trial_credits(uuid) to authenticated, service_role;

revoke all on function public.reserve_trial_credit(text, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_trial_credit(text, text, text, uuid, integer) to service_role;

revoke all on function public.settle_trial_credit(text, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_trial_credit(text, uuid, text) to service_role;

revoke all on function public.release_trial_credit(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.release_trial_credit(text, text, uuid, text) to service_role;

revoke all on function public.record_trial_result_ready(text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.record_trial_result_ready(text, jsonb, uuid, text) to service_role;

revoke all on function public.claim_expired_temp_pdf_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_expired_temp_pdf_jobs(integer) to service_role;

revoke all on function public.claim_temp_pdf_job_for_conversion(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_temp_pdf_job_for_conversion(text, uuid, text) to service_role;

revoke all on function public.claim_temp_pdf_cleanup_by_converter(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_temp_pdf_cleanup_by_converter(text, uuid, text) to service_role;

revoke all on function public.finalize_temp_pdf_cleanup(text, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_temp_pdf_cleanup(text, text, text, text) to service_role;
