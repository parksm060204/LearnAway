-- ==============================================================================
-- Migration 20260101000035: Fix AI Task Settlement Discrimination and Snapshot Cache
--
-- 1. Updates register_ai_task to return explicit 'db_status' ('result_ready' vs 'settled')
--    in 'already_completed' responses, enabling callers to distinguish between preserved
--    results awaiting settlement and fully finalized settlements.
-- 2. Preserves strict multi-account task isolation, fencing tokens, and input idempotency locks.
-- ==============================================================================

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
  v_same_input public.ai_trial_reservations%rowtype;
  v_balance integer;
  v_daily_calls integer;
  v_lease_token text;
  v_initial_grant integer;
  v_target_source text;
  v_cap integer;
begin
  -- 1. Resolve user
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

  -- 2. Validate parameters
  if coalesce(p_task_id, '') = '' or coalesce(p_task_type, '') = '' or coalesce(p_input_identifier, '') = '' then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'INVALID_PARAMETERS',
      'code', 'INVALID_PARAMETERS',
      'error', 'INVALID_PARAMETERS',
      'message', '작업 식별자와 입력값이 유효하지 않습니다.'
    );
  end if;

  if p_task_type not in (
    'analyze_concepts',
    'generate_problems',
    'evaluate_answer',
    'logic_questions',
    'transfer_problem',
    'review_problem_quality'
  ) then
    return jsonb_build_object(
      'allowed', false,
      'error_code', 'INVALID_TASK_TYPE',
      'code', 'INVALID_TASK_TYPE',
      'error', 'INVALID_TASK_TYPE',
      'message', '지원하지 않는 작업 유형입니다.'
    );
  end if;

  v_target_source := case when p_is_personal_key then 'personal_key' else 'operator_trial' end;
  v_cap := coalesce(p_daily_cap, 500);

  -- Concurrency control on (user, task_type, input_identifier) to prevent random taskId bypasses
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || p_task_type || ':' || p_input_identifier));

  -- 3. Check existing task reservation with row lock by task_id
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
        'task_id', v_existing.task_id,
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
        'task_id', v_existing.task_id,
        'message', '동일한 작업 ID에 서로 다른 입력이 전달되었습니다.'
      );
    end if;

    -- Check credit source mismatch (prevents payment switching bypasses)
    if v_existing.credit_source <> v_target_source then
      return jsonb_build_object(
        'allowed', false,
        'error_code', 'TASK_CREDIT_SOURCE_MISMATCH',
        'code', 'TASK_CREDIT_SOURCE_MISMATCH',
        'error', 'TASK_CREDIT_SOURCE_MISMATCH',
        'task_id', v_existing.task_id,
        'message', '기존 작업의 결제 방식(credit_source)과 요청된 결제 방식이 일치하지 않습니다.'
      );
    end if;

    -- Get current balance if available
    select balance into v_balance
    from public.ai_trial_credits
    where user_id = v_uid;

    -- If settled or result_ready (preserved result exists), return already_completed with explicit db_status
    if v_existing.status = 'settled' or v_existing.status = 'result_ready' or v_existing.cached_result is not null then
      return jsonb_build_object(
        'allowed', false,
        'status', 'already_completed',
        'db_status', v_existing.status,
        'remaining', coalesce(v_balance, 0),
        'cached_result', v_existing.cached_result,
        'lease_token', v_existing.lease_token,
        'credit_source', v_existing.credit_source,
        'task_id', v_existing.task_id,
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
        'error_code', 'CONCURRENT_EXECUTION_BLOCKED',
        'code', 'CONCURRENT_EXECUTION_BLOCKED',
        'error', 'CONCURRENT_EXECUTION_BLOCKED',
        'remaining', coalesce(v_balance, 0),
        'credit_source', v_existing.credit_source,
        'task_id', v_existing.task_id,
        'message', '동일한 작업이 현재 처리 중입니다.'
      );
    end if;

    -- Check maximum retry attempt limits before external AI execution
    if v_existing.attempt_count >= 5 and coalesce(v_existing.release_reason, '') <> 'intermediate_chunk' then
      return jsonb_build_object(
        'allowed', false,
        'error_code', 'MAX_RETRIES_EXCEEDED',
        'code', 'MAX_RETRIES_EXCEEDED',
        'error', 'MAX_RETRIES_EXCEEDED',
        'remaining', coalesce(v_balance, 0),
        'task_id', v_existing.task_id,
        'message', '동일 작업의 최대 재시도 한도를 초과했습니다.'
      );
    end if;

    -- Handle retry based on previous reservation state:
    v_lease_token := 'lt_' || replace(gen_random_uuid()::text, '-', '');

    if v_existing.status in ('released', 'failed_refunded') then
      -- Previous trial credit was refunded. Re-reservation requires checking balance and re-deducting 1 credit!
      if not p_is_personal_key then
        select balance into v_balance
        from public.ai_trial_credits
        where user_id = v_uid
        for update;

        if not found then
          v_initial_grant := public.determine_initial_trial_credits(v_uid);
          insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
          values (v_uid, v_initial_grant, v_initial_grant, now(), now())
          on conflict (user_id) do nothing;

          select balance into v_balance
          from public.ai_trial_credits
          where user_id = v_uid
          for update;
        end if;

        if coalesce(v_balance, 0) < 1 then
          return jsonb_build_object(
            'allowed', false,
            'status', 'insufficient_credits',
            'error_code', 'INSUFFICIENT_CREDITS',
            'code', 'INSUFFICIENT_CREDITS',
            'error', 'INSUFFICIENT_CREDITS',
            'remaining', coalesce(v_balance, 0),
            'task_id', v_existing.task_id,
            'message', '체험 크레딧이 부족합니다. 개인 API 키를 등록하여 계속 학습해 주세요.'
          );
        end if;

        update public.ai_trial_credits
        set balance = balance - 1,
            updated_at = now()
        where user_id = v_uid;

        v_balance := v_balance - 1;

        -- Record operator daily usage on new deduction
        insert into public.operator_ai_daily_usage (usage_date, call_count)
        values (current_date, 1)
        on conflict (usage_date)
        do update set call_count = operator_ai_daily_usage.call_count + 1
        returning call_count into v_daily_calls;

        if v_daily_calls > v_cap then
          -- Rollback credit deduction
          update public.ai_trial_credits
          set balance = balance + 1,
              updated_at = now()
          where user_id = v_uid;

          update public.operator_ai_daily_usage
          set call_count = call_count - 1
          where usage_date = current_date;

          return jsonb_build_object(
            'allowed', false,
            'status', 'daily_cap_exceeded',
            'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
            'code', 'OPERATOR_DAILY_CAP_EXCEEDED',
            'error', 'OPERATOR_DAILY_CAP_EXCEEDED',
            'remaining', coalesce(v_balance + 1, 0),
            'task_id', v_existing.task_id,
            'message', '금일 운영자 AI 체험 제공 한도가 초과되었습니다. 내일 다시 이용하시거나 개인 API 키를 등록해 주세요.'
          );
        end if;
      end if;

      -- Update task reservation to processing with new lease token and increment attempt_count
      update public.ai_trial_reservations
      set
        status = 'processing',
        attempt_count = attempt_count + 1,
        lease_token = v_lease_token,
        lease_expires_at = now() + interval '60 seconds',
        release_reason = null,
        error_code = null
      where task_id = p_task_id;

      return jsonb_build_object(
        'allowed', true,
        'status', 'processing',
        'remaining', coalesce(v_balance, 0),
        'lease_token', v_lease_token,
        'credit_source', v_target_source,
        'task_id', v_existing.task_id
      );
    else
      -- Expired lease without explicit release/refund: credit was ALREADY deducted on initial reservation!
      -- Do NOT deduct balance again! Only re-issue fresh lease token and increment attempt_count.
      if not p_is_personal_key then
        -- Count operator daily calls on re-execution
        insert into public.operator_ai_daily_usage (usage_date, call_count)
        values (current_date, 1)
        on conflict (usage_date)
        do update set call_count = operator_ai_daily_usage.call_count + 1
        returning call_count into v_daily_calls;

        if v_daily_calls > v_cap then
          update public.operator_ai_daily_usage
          set call_count = call_count - 1
          where usage_date = current_date;

          return jsonb_build_object(
            'allowed', false,
            'status', 'daily_cap_exceeded',
            'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
            'code', 'OPERATOR_DAILY_CAP_EXCEEDED',
            'error', 'OPERATOR_DAILY_CAP_EXCEEDED',
            'remaining', coalesce(v_balance, 0),
            'task_id', v_existing.task_id,
            'message', '금일 운영자 AI 체험 제공 한도가 초과되었습니다. 내일 다시 이용하시거나 개인 API 키를 등록해 주세요.'
          );
        end if;
      end if;

      update public.ai_trial_reservations
      set
        status = 'processing',
        attempt_count = case
          when v_existing.release_reason = 'intermediate_chunk' then attempt_count
          else attempt_count + 1
        end,
        lease_token = v_lease_token,
        lease_expires_at = now() + interval '60 seconds',
        release_reason = null,
        error_code = null
      where task_id = p_task_id;

      return jsonb_build_object(
        'allowed', true,
        'status', 'processing',
        'remaining', coalesce(v_balance, 0),
        'lease_token', v_lease_token,
        'credit_source', v_target_source,
        'task_id', v_existing.task_id
      );
    end if;
  end if;

  -- 4. Brand new task registration:
  -- Check if another task with the same (user_id, task_type, input_identifier) is already active or completed
  select * into v_same_input
  from public.ai_trial_reservations
  where user_id = v_uid
    and task_type = p_task_type
    and input_identifier = p_input_identifier
    and status in ('reserved', 'processing')
    and lease_expires_at is not null
    and lease_expires_at > now()
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'allowed', false,
      'status', 'concurrent_in_progress',
      'error_code', 'CONCURRENT_EXECUTION_BLOCKED',
      'code', 'CONCURRENT_EXECUTION_BLOCKED',
      'credit_source', v_same_input.credit_source,
      'task_id', v_same_input.task_id,
      'message', '동일한 입력의 작업이 현재 실행 중입니다. 잠시 후 결과를 확인해 주세요.'
    );
  end if;

  select * into v_same_input
  from public.ai_trial_reservations
  where user_id = v_uid
    and task_type = p_task_type
    and input_identifier = p_input_identifier
    and (status in ('settled', 'result_ready') or cached_result is not null)
  order by created_at desc
  limit 1;

  if found and v_same_input.cached_result is not null then
    return jsonb_build_object(
      'allowed', false,
      'status', 'already_completed',
      'db_status', v_same_input.status,
      'remaining', coalesce(v_balance, 0),
      'cached_result', v_same_input.cached_result,
      'lease_token', v_same_input.lease_token,
      'credit_source', v_same_input.credit_source,
      'task_id', v_same_input.task_id,
      'message', '이미 완료된 작업의 결과가 보존되어 있습니다.'
    );
  end if;

  v_lease_token := 'lt_' || replace(gen_random_uuid()::text, '-', '');

  if p_is_personal_key then
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
      'remaining', null,
      'lease_token', v_lease_token,
      'credit_source', 'personal_key',
      'task_id', p_task_id
    );
  else
    -- Operator trial registration requires balance check and atomic deduction
    select balance into v_balance
    from public.ai_trial_credits
    where user_id = v_uid
    for update;

    if not found then
      v_initial_grant := public.determine_initial_trial_credits(v_uid);
      insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
      values (v_uid, v_initial_grant, v_initial_grant, now(), now())
      on conflict (user_id) do nothing;

      select balance into v_balance
      from public.ai_trial_credits
      where user_id = v_uid
      for update;
    end if;

    if coalesce(v_balance, 0) < 1 then
      return jsonb_build_object(
        'allowed', false,
        'status', 'insufficient_credits',
        'error_code', 'INSUFFICIENT_CREDITS',
        'code', 'INSUFFICIENT_CREDITS',
        'error', 'INSUFFICIENT_CREDITS',
        'remaining', coalesce(v_balance, 0),
        'task_id', p_task_id,
        'message', '체험 크레딧이 부족합니다. 개인 API 키를 등록하여 계속 학습해 주세요.'
      );
    end if;

    -- Daily cap check
    insert into public.operator_ai_daily_usage (usage_date, call_count)
    values (current_date, 1)
    on conflict (usage_date)
    do update set call_count = operator_ai_daily_usage.call_count + 1
    returning call_count into v_daily_calls;

    if v_daily_calls > v_cap then
      update public.operator_ai_daily_usage
      set call_count = call_count - 1
      where usage_date = current_date;

      return jsonb_build_object(
        'allowed', false,
        'status', 'daily_cap_exceeded',
        'error_code', 'OPERATOR_DAILY_CAP_EXCEEDED',
        'code', 'OPERATOR_DAILY_CAP_EXCEEDED',
        'error', 'OPERATOR_DAILY_CAP_EXCEEDED',
        'remaining', coalesce(v_balance, 0),
        'task_id', p_task_id,
        'message', '금일 운영자 AI 체험 제공 한도가 초과되었습니다. 내일 다시 이용하시거나 개인 API 키를 등록해 주세요.'
      );
    end if;

    -- Deduct credit
    update public.ai_trial_credits
    set balance = balance - 1,
        updated_at = now()
    where user_id = v_uid;

    v_balance := v_balance - 1;

    -- Create reservation entry
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
      'remaining', v_balance,
      'lease_token', v_lease_token,
      'credit_source', 'operator_trial',
      'task_id', p_task_id
    );
  end if;
end;
$$;

revoke execute on function public.register_ai_task(text, text, text, uuid, boolean, integer) from public, anon;
grant execute on function public.register_ai_task(text, text, text, uuid, boolean, integer) to authenticated, service_role;
