-- ==============================================================================
-- Migration 20260101000031: AI Task Idempotency, Unified Task Registry & Admin Telemetry
--
-- 1. Unified Task Identity & Reservation (register_ai_task)
--    - Enforces atomic binding of (task_id, user_id, task_type, input_identifier)
--    - Rejects cross-user task reuse (TASK_OWNERSHIP_MISMATCH)
--    - Rejects reusing same task_id with different input (TASK_INPUT_MISMATCH)
--    - Supports personal_key paths: records identity and lease_token without credit deduction
--    - Supports operator_trial paths: atomically checks balance and daily cap
--    - Returns already_completed if result was already generated and preserved
--    - Returns concurrent_in_progress if another execution is in flight with active lease
--
-- 2. Authoritative Saved Result Lookup (lookup_saved_ai_task_result)
--    - Used by save retries (isSaveRetry: true, action: 'retry_save')
--    - Verifies ownership and input identifier
--    - Returns preserved cached_result and lease_token without invoking AI
--    - Rejects if task not found or no cached result exists (prevents free AI execution)
-- ==============================================================================

-- 1. Add credit_source column to ai_trial_reservations if not exists
alter table public.ai_trial_reservations
  add column if not exists credit_source text not null default 'operator_trial'
  check (credit_source in ('operator_trial', 'personal_key'));

-- 2. Unified Task Registration and Reservation RPC
create or replace function public.register_ai_task(
  p_task_id text,
  p_task_type text,
  p_input_identifier text,
  p_user_id uuid default null,
  p_is_personal_key boolean default false,
  p_daily_cap integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_existing public.ai_trial_reservations%rowtype;
  v_balance integer;
  v_daily_calls integer;
  v_lease_token text;
begin
  -- Resolve user
  v_uid := coalesce(p_user_id, auth.uid());
  if v_uid is null then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'UNAUTHENTICATED',
      'code', 'UNAUTHENTICATED',
      'error', 'UNAUTHENTICATED',
      'message', '로그인이 필요합니다.'
    );
  end if;

  -- Validate inputs
  if coalesce(p_task_id, '') = '' or coalesce(p_task_type, '') = '' or coalesce(p_input_identifier, '') = '' then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'INVALID_PARAMETERS',
      'code', 'INVALID_PARAMETERS',
      'error', 'INVALID_PARAMETERS',
      'message', '작업 식별자와 입력값이 유효하지 않습니다.'
    );
  end if;

  -- Atomic check on existing reservation with row lock
  select * into v_existing
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if found then
    -- Check ownership
    if v_existing.user_id <> v_uid then
      return jsonb_build_object(
        'allowed', false,
        'error_code', 'TASK_OWNERSHIP_MISMATCH',
        'code', 'TASK_OWNERSHIP_MISMATCH',
        'error', 'TASK_OWNERSHIP_MISMATCH',
        'message', '해당 작업에 대한 접근 권한이 없습니다.'
      );
    end if;

    -- Check input identifier mismatch
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

    -- If settled or result_ready (preserved result exists), return already_completed
    if v_existing.status = 'settled' or v_existing.status = 'result_ready' or v_existing.cached_result is not null then
      return jsonb_build_object(
        'allowed', false,
        'status', 'already_completed',
        'remaining', coalesce(v_balance, 0),
        'cached_result', v_existing.cached_result,
        'lease_token', v_existing.lease_token,
        'message', '이미 생성된 AI 결과가 보존되어 있습니다.'
      );
    end if;

    -- If currently in flight with an active lease, block duplicate execution
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

    -- Expired lease without result: refresh lease token for retry
    v_lease_token := 'lt_' || replace(gen_random_uuid()::text, '-', '');
    update public.ai_trial_reservations
    set
      status = 'processing',
      attempt_count = attempt_count + 1,
      lease_token = v_lease_token,
      lease_expires_at = now() + interval '60 seconds'
    where task_id = p_task_id;

    return jsonb_build_object(
      'allowed', true,
      'status', 'processing',
      'remaining', coalesce(v_balance, 0),
      'lease_token', v_lease_token
    );
  end if;

  -- Brand new task registration:
  v_lease_token := 'lt_' || replace(gen_random_uuid()::text, '-', '');

  if p_is_personal_key then
    -- Personal key path: no trial balance deduction, but record identity and lease_token
    insert into public.ai_trial_reservations (
      task_id, user_id, task_type, input_identifier, status,
      attempt_count, lease_token, lease_expires_at, created_at, credit_source
    ) values (
      p_task_id, v_uid, p_task_type, p_input_identifier, 'processing',
      1, v_lease_token, now() + interval '60 seconds', now(), 'personal_key'
    );

    return jsonb_build_object(
      'allowed', true,
      'status', 'processing',
      'lease_token', v_lease_token,
      'credit_source', 'personal_key'
    );
  else
    -- Operator trial credit path: check balance and operator daily cap
    select balance into v_balance
    from public.ai_trial_credits
    where user_id = v_uid
    for update;

    if not found or coalesce(v_balance, 0) < 1 then
      return jsonb_build_object(
        'allowed', false,
        'status', 'insufficient_credits',
        'error_code', 'INSUFFICIENT_CREDITS',
        'code', 'INSUFFICIENT_CREDITS',
        'error', 'INSUFFICIENT_CREDITS',
        'remaining', coalesce(v_balance, 0),
        'message', '체험 크레딧이 모두 소진되었습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.'
      );
    end if;

    insert into public.operator_ai_daily_usage (usage_date, call_count)
    values (current_date, 1)
    on conflict (usage_date)
    do update set call_count = operator_ai_daily_usage.call_count + 1
    returning call_count into v_daily_calls;

    if v_daily_calls > coalesce(p_daily_cap, 500) then
      return jsonb_build_object(
        'allowed', false,
        'status', 'daily_cap_exceeded',
        'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
        'code', 'OPERATOR_DAILY_CAP_EXCEEDED',
        'error', 'OPERATOR_DAILY_CAP_EXCEEDED',
        'remaining', v_balance,
        'message', '금일 운영자 AI 체험 제공 한도가 초과되었습니다. 내일 다시 이용하시거나 개인 API 키를 등록해 주세요.'
      );
    end if;

    -- Decrement balance atomically
    update public.ai_trial_credits
    set balance = balance - 1, updated_at = now()
    where user_id = v_uid;

    insert into public.ai_trial_reservations (
      task_id, user_id, task_type, input_identifier, status,
      attempt_count, lease_token, lease_expires_at, created_at, credit_source
    ) values (
      p_task_id, v_uid, p_task_type, p_input_identifier, 'processing',
      1, v_lease_token, now() + interval '60 seconds', now(), 'operator_trial'
    );

    return jsonb_build_object(
      'allowed', true,
      'status', 'processing',
      'remaining', v_balance - 1,
      'lease_token', v_lease_token,
      'credit_source', 'operator_trial'
    );
  end if;
end;
$$;

revoke all on function public.register_ai_task(text, text, text, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.register_ai_task(text, text, text, uuid, boolean, integer) to service_role;

-- 3. Authoritative Saved Result Lookup for Save Retries
create or replace function public.lookup_saved_ai_task_result(
  p_task_id text,
  p_user_id uuid default null,
  p_task_type text default null,
  p_input_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_res public.ai_trial_reservations%rowtype;
begin
  v_uid := coalesce(p_user_id, auth.uid());
  if v_uid is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHENTICATED',
      'message', '로그인이 필요합니다.'
    );
  end if;

  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TASK_NOT_FOUND',
      'message', '저장 재시도할 기존 작업 기록을 찾을 수 없습니다.'
    );
  end if;

  if v_res.user_id <> v_uid then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TASK_OWNERSHIP_MISMATCH',
      'message', '해당 작업에 대한 접근 권한이 없습니다.'
    );
  end if;

  if p_task_type is not null and v_res.task_type <> p_task_type then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TASK_TYPE_MISMATCH',
      'message', '작업 종류가 일치하지 않습니다.'
    );
  end if;

  if p_input_identifier is not null and v_res.input_identifier <> p_input_identifier then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TASK_INPUT_MISMATCH',
      'message', '동일한 작업 ID에 서로 다른 입력이 전달되었습니다.'
    );
  end if;

  if v_res.cached_result is null then
    return jsonb_build_object(
      'success', false,
      'error_code', 'NO_SAVED_RESULT',
      'message', '서버에 보존된 AI 생성 결과가 없습니다. 새로운 작업으로 다시 요청해 주세요.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', v_res.status,
    'cached_result', v_res.cached_result,
    'lease_token', v_res.lease_token,
    'credit_source', v_res.credit_source
  );
end;
$$;

revoke all on function public.lookup_saved_ai_task_result(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.lookup_saved_ai_task_result(text, uuid, text, text) to service_role;
