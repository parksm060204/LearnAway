-- ==============================================================================
-- Migration 27: Tiered AI Trial Credits by Account Type & Migration Hardening
--
-- Business Rules (P01-02):
-- 1. Guest / Simple username accounts (username_accounts / auth_type = 'username'):
--    Initial grant = 1 trial credit
-- 2. General accounts (Google OAuth / verified standard email):
--    Initial grant = 3 trial credits
-- 3. Existing accounts:
--    Historical granted_credits and balance are strictly preserved (no reset, no tampering).
-- 4. Guest-to-General transition:
--    Idempotent ON CONFLICT (user_id) DO NOTHING ensures no duplicate grants.
-- 5. Unified Server-Side Single Source of Truth:
--    Account tier determination is centralized in determine_initial_trial_credits(p_user_id)
--    and used identically by both get_or_create_trial_credits() and reserve_trial_credit().
-- ==============================================================================

-- ----------------------------------------------------------------------------
-- 1. Single source of truth for account tier determination
-- ----------------------------------------------------------------------------
create or replace function public.determine_initial_trial_credits(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_guest boolean := false;
begin
  if p_user_id is null then
    return 1;
  end if;

  select exists (
    select 1 from public.username_accounts where user_id = p_user_id
  ) into v_is_guest;

  if not v_is_guest then
    select exists (
      select 1 from auth.users
      where id = p_user_id
        and (
          (raw_user_meta_data->>'auth_type') = 'username'
          or email like '%@id.learnaway.local'
        )
    ) into v_is_guest;
  end if;

  if v_is_guest then
    return 1;
  else
    return 3;
  end if;
end;
$$;

revoke all on function public.determine_initial_trial_credits(uuid) from public, anon;
grant execute on function public.determine_initial_trial_credits(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. get_or_create_trial_credits for authenticated caller
-- ----------------------------------------------------------------------------
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
  v_initial_grant integer := 3;
  v_is_guest boolean := false;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  -- 1. Check if record already exists to preserve existing balances and prevent duplicate grants
  select granted_credits, balance into v_granted, v_balance
  from public.ai_trial_credits
  where user_id = v_uid;

  if v_granted is null then
    v_initial_grant := public.determine_initial_trial_credits(v_uid);
    v_is_guest := (v_initial_grant = 1);

    -- Atomic insert with conflict protection (handles concurrent first-requests safely)
    insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
    values (v_uid, v_initial_grant, v_initial_grant, now(), now())
    on conflict (user_id) do nothing;

    -- Re-fetch committed row in case of concurrent insert race
    select granted_credits, balance into v_granted, v_balance
    from public.ai_trial_credits
    where user_id = v_uid;
  else
    v_is_guest := (public.determine_initial_trial_credits(v_uid) = 1);
  end if;

  -- 3. Check personal API connection status
  select exists(
    select 1 from public.ai_connections
    where user_id = v_uid
      and status = 'connected'
      and api_key_ciphertext is not null
      and api_key_ciphertext <> ''
  ) into v_has_key;

  return jsonb_build_object(
    'granted', coalesce(v_granted, v_initial_grant),
    'balance', coalesce(v_balance, 0),
    'hasPersonalKey', v_has_key,
    'isGuest', coalesce(v_is_guest, false)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. get_or_create_trial_credits overload for service_role / explicit user_id
-- ----------------------------------------------------------------------------
create or replace function public.get_or_create_trial_credits(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text := coalesce(auth.role(), current_user);
  v_uid uuid := p_user_id;
  v_granted integer;
  v_balance integer;
  v_has_key boolean := false;
  v_initial_grant integer := 3;
  v_is_guest boolean := false;
begin
  if v_uid is null then
    raise exception 'USER_ID_REQUIRED' using errcode = 'P0002';
  end if;

  -- If not service_role, callers can only query their own user_id
  if v_caller_role <> 'service_role' and (auth.uid() is null or auth.uid() <> v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select granted_credits, balance into v_granted, v_balance
  from public.ai_trial_credits
  where user_id = v_uid;

  if v_granted is null then
    v_initial_grant := public.determine_initial_trial_credits(v_uid);
    v_is_guest := (v_initial_grant = 1);

    insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
    values (v_uid, v_initial_grant, v_initial_grant, now(), now())
    on conflict (user_id) do nothing;

    select granted_credits, balance into v_granted, v_balance
    from public.ai_trial_credits
    where user_id = v_uid;
  else
    v_is_guest := (public.determine_initial_trial_credits(v_uid) = 1);
  end if;

  select exists(
    select 1 from public.ai_connections
    where user_id = v_uid
      and status = 'connected'
      and api_key_ciphertext is not null
      and api_key_ciphertext <> ''
  ) into v_has_key;

  return jsonb_build_object(
    'granted', coalesce(v_granted, v_initial_grant),
    'balance', coalesce(v_balance, 0),
    'hasPersonalKey', v_has_key,
    'isGuest', coalesce(v_is_guest, false)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Re-harmonize reserve_trial_credit to use determine_initial_trial_credits
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
  v_initial_grant integer := 3;
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

    -- If previously refunded (released), atomically verify balance and re-deduct 1 credit!
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

      insert into public.operator_ai_daily_usage (usage_date, call_count)
      values (current_date, 1)
      on conflict (usage_date) do update set
        call_count = operator_ai_daily_usage.call_count + 1
      returning call_count into v_daily_count;

      if v_daily_count > v_cap then
        return jsonb_build_object(
          'allowed', false,
          'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
          'message', '오늘의 운영자 AI 체험 전체 한도가 마감되었습니다. 설정에서 개인 API 키를 등록해 주세요.'
        );
      end if;

      update public.ai_trial_credits
      set balance = balance - 1,
          updated_at = now()
      where user_id = v_uid
      returning balance into v_balance;
    end if;

    v_lease_token := gen_random_uuid()::text;

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
  -- Unified account tier initialization: Guest = 1, General = 3
  v_initial_grant := public.determine_initial_trial_credits(v_uid);

  insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
  values (v_uid, v_initial_grant, v_initial_grant, now(), now())
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
    call_count = operator_ai_daily_usage.call_count + 1
  returning call_count into v_daily_count;

  if v_daily_count > v_cap then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
      'message', '오늘의 운영자 AI 체험 전체 한도가 마감되었습니다. 설정에서 개인 API 키를 등록해 주세요.'
    );
  end if;

  -- Deduct 1 credit atomically
  update public.ai_trial_credits
  set balance = balance - 1,
      updated_at = now()
  where user_id = v_uid;

  v_lease_token := gen_random_uuid()::text;

  insert into public.ai_trial_reservations (
    task_id, user_id, task_type, input_identifier, status,
    attempt_count, lease_token, lease_expires_at, created_at, updated_at
  ) values (
    p_task_id, v_uid, p_task_type, p_input_identifier, 'processing',
    1, v_lease_token, now() + interval '60 seconds', now(), now()
  );

  return jsonb_build_object(
    'allowed', true,
    'status', 'reserved',
    'remaining', v_balance - 1,
    'lease_token', v_lease_token
  );
end;
$$;

-- Enforce strict permission boundaries
revoke all on function public.get_or_create_trial_credits() from public, anon;
grant execute on function public.get_or_create_trial_credits() to authenticated, service_role;

revoke all on function public.get_or_create_trial_credits(uuid) from public, anon;
grant execute on function public.get_or_create_trial_credits(uuid) to authenticated, service_role;

revoke all on function public.reserve_trial_credit(text, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_trial_credit(text, text, text, uuid, integer) to service_role;
