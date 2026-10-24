-- ==============================================================================
-- Migration 20260101000032: AI Task Retry Budget Enforcement, Autonomous Credit
-- Initialization, Decoupled Task Lifecycle & Authoritative Usage Aggregation
--
-- 1. Hardened register_ai_task:
--    - Enforces strict credit_source consistency (prevents payment switching bypasses)
--    - Atomic credit check & re-deduction on retrying released/failed_refunded tasks
--    - Preserves trial balance on expired processing retries without double deduction
--    - Enforces operator daily call limits on all actual external AI execution attempts
--    - Enforces maximum attempt limits (attempt_count >= 5) before external execution
--    - Autonomous tiered credit initialization via determine_initial_trial_credits
--      if no credit row exists (eliminates query-order dependency)
--
-- 2. Decoupled release_trial_credit:
--    - Differentiates credit_source: personal_key tasks release lease without inflating trial credits
--    - Operator trial tasks atomically refund exactly 1 credit (up to granted limit)
--
-- 3. Atomic Lease Clearance RPC (clear_ai_task_lease):
--    - Allows intermediate chunk completion in multi-chunk analysis to clear active lease
--      so normal progression to next chunk is not blocked by concurrent execution guards
--
-- 4. Authoritative DB Usage Aggregation (aggregate_ai_usage_telemetry):
--    - Aggregates metrics over entire filtered dataset independent of pagination limit
-- ==============================================================================

-- 1. Unified Task Registration & Budget Verification RPC
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

  v_target_source := case when p_is_personal_key then 'personal_key' else 'operator_trial' end;
  v_cap := coalesce(p_daily_cap, 500);

  -- 3. Check existing task reservation with row lock
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

    -- Check credit source mismatch (prevents payment switching bypasses)
    if v_existing.credit_source <> v_target_source then
      return jsonb_build_object(
        'allowed', false,
        'error_code', 'TASK_CREDIT_SOURCE_MISMATCH',
        'code', 'TASK_CREDIT_SOURCE_MISMATCH',
        'error', 'TASK_CREDIT_SOURCE_MISMATCH',
        'message', '기존 작업의 결제 방식(credit_source)과 요청된 결제 방식이 일치하지 않습니다.'
      );
    end if;

    -- Get current balance if available
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
        'credit_source', v_existing.credit_source,
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
        'message', '동일한 작업이 현재 처리 중입니다.'
      );
    end if;

    -- Check maximum retry attempt limits before external AI execution
    if v_existing.attempt_count >= 5 then
      return jsonb_build_object(
        'allowed', false,
        'error_code', 'MAX_RETRIES_EXCEEDED',
        'code', 'MAX_RETRIES_EXCEEDED',
        'error', 'MAX_RETRIES_EXCEEDED',
        'remaining', coalesce(v_balance, 0),
        'message', '동일 작업의 최대 재시도 한도를 초과했습니다.'
      );
    end if;

    -- Handle retry based on previous reservation state:
    v_lease_token := 'lt_' || replace(gen_random_uuid()::text, '-', '');

    if v_existing.status in ('released', 'failed_refunded') then
      -- Previous trial credit was refunded. Re-reservation requires checking balance and re-deducting 1 credit!
      if not p_is_personal_key then
        -- Autonomous credit initialization if row missing
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
            'message', '체험 크레딧이 모두 소진되었습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.'
          );
        end if;

        -- Check operator daily cap for new external AI execution
        insert into public.operator_ai_daily_usage (usage_date, call_count)
        values (current_date, 1)
        on conflict (usage_date)
        do update set call_count = operator_ai_daily_usage.call_count + 1
        returning call_count into v_daily_calls;

        if v_daily_calls > v_cap then
          -- Roll back increment so rejected request does not inflate usage count
          update public.operator_ai_daily_usage
          set call_count = call_count - 1
          where usage_date = current_date;

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

        -- Deduct 1 credit atomically
        update public.ai_trial_credits
        set balance = balance - 1, updated_at = now()
        where user_id = v_uid;
        v_balance := v_balance - 1;
      end if;

      update public.ai_trial_reservations
      set
        status = 'processing',
        attempt_count = attempt_count + 1,
        lease_token = v_lease_token,
        lease_expires_at = now() + interval '60 seconds',
        released_at = null,
        release_reason = null,
        error_code = null
      where task_id = p_task_id;

      return jsonb_build_object(
        'allowed', true,
        'status', 'processing',
        'remaining', coalesce(v_balance, 0),
        'lease_token', v_lease_token,
        'credit_source', v_target_source
      );
    else
      -- Expired lease without result: credit was ALREADY deducted and NOT refunded.
      -- Do NOT double-deduct from trial balance, but apply daily cap to new external AI attempt!
      if not p_is_personal_key then
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
            'message', '금일 운영자 AI 체험 제공 한도가 초과되었습니다. 내일 다시 이용하시거나 개인 API 키를 등록해 주세요.'
          );
        end if;
      end if;

      update public.ai_trial_reservations
      set
        status = 'processing',
        attempt_count = attempt_count + 1,
        lease_token = v_lease_token,
        lease_expires_at = now() + interval '60 seconds',
        error_code = null
      where task_id = p_task_id;

      return jsonb_build_object(
        'allowed', true,
        'status', 'processing',
        'remaining', coalesce(v_balance, 0),
        'lease_token', v_lease_token,
        'credit_source', v_target_source
      );
    end if;
  end if;

  -- 4. Brand new task registration:
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
      'lease_token', v_lease_token,
      'credit_source', 'personal_key'
    );
  else
    -- Operator trial credit path: autonomous tiered credit initialization & atomic deduction
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
        'message', '체험 크레딧이 모두 소진되었습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.'
      );
    end if;

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
        'remaining', v_balance,
        'message', '금일 운영자 AI 체험 제공 한도가 초과되었습니다. 내일 다시 이용하시거나 개인 API 키를 등록해 주세요.'
      );
    end if;

    -- Deduct 1 credit atomically
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

-- 2. Decoupled release_trial_credit: Prevents personal_key tasks from inflating trial balance
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

  -- 1. Settled task cannot be refunded
  if v_res.status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'ALREADY_SETTLED', 'error_code', 'ALREADY_SETTLED', 'message', '이미 확정된 작업은 환급할 수 없습니다.');
  end if;

  -- 2. Idempotency Check: if already released/refunded, return read-only success without double refunding
  if v_res.status in ('released', 'failed_refunded') then
    if v_res.last_lease_token is not null and v_res.last_lease_token <> v_token then
      return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN', 'message', '유효하지 않거나 만료된 실행 토큰입니다.');
    end if;
    if v_res.last_lease_token is null and v_res.lease_token is not null and v_res.lease_token <> v_token then
      return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN', 'message', '유효하지 않거나 만료된 실행 토큰입니다.');
    end if;
    select balance into v_new_balance from public.ai_trial_credits where user_id = v_uid;
    return jsonb_build_object(
      'success', true,
      'status', v_res.status,
      'refunded', false,
      'balance', coalesce(v_new_balance, 0),
      'remaining', coalesce(v_new_balance, 0),
      'credit_source', v_res.credit_source,
      'message', '이미 완료되었거나 환급된 작업입니다.'
    );
  end if;

  -- 3. Strict active lease token check for unreleased tasks
  if v_res.lease_token is null or v_res.lease_token <> v_token then
    return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN', 'message', '유효하지 않거나 만료된 실행 토큰입니다.');
  end if;

  -- 4. Result ready guard: tasks with preserved AI results MUST NOT be refunded
  if v_res.status = 'result_ready' or v_res.cached_result is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'CANNOT_REFUND_RESULT_READY',
      'error_code', 'CANNOT_REFUND_RESULT_READY',
      'message', '이미 AI 결과가 생성 및 보존된 작업은 환급할 수 없습니다. 결과 저장 및 정산을 재시도해 주세요.'
    );
  end if;

  -- 5. Atomic state transition
  update public.ai_trial_reservations
  set status = 'failed_refunded',
      released_at = now(),
      release_reason = coalesce(p_reason, 'cancelled_or_failed'),
      last_lease_token = v_token,
      lease_token = null,
      lease_expires_at = null
  where task_id = p_task_id
    and lease_token = v_token;

  -- 6. Refund trial credits ONLY for operator_trial tasks!
  if v_res.credit_source = 'operator_trial' then
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
      'remaining', v_new_balance,
      'credit_source', 'operator_trial'
    );
  else
    -- Personal key tasks: state released, trial balance unmutated
    select balance into v_new_balance from public.ai_trial_credits where user_id = v_uid;
    return jsonb_build_object(
      'success', true,
      'status', 'released',
      'refunded', false,
      'balance', coalesce(v_new_balance, 0),
      'remaining', coalesce(v_new_balance, 0),
      'credit_source', 'personal_key'
    );
  end if;
end;
$$;

revoke all on function public.release_trial_credit(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.release_trial_credit(text, text, uuid, text) to service_role;

-- 3. Atomic Lease Clearance RPC for Intermediate Chunk Progress in Multi-Chunk Tasks
create or replace function public.clear_ai_task_lease(
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
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'error_code', 'UNAUTHORIZED');
  end if;

  if coalesce(p_task_id, '') = '' or v_token = '' then
    return jsonb_build_object('success', false, 'error', 'INVALID_PARAMETERS', 'error_code', 'INVALID_PARAMETERS');
  end if;

  select * into v_res
  from public.ai_trial_reservations
  where task_id = p_task_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'error_code', 'TASK_NOT_FOUND');
  end if;

  if v_res.user_id <> v_uid then
    return jsonb_build_object('success', false, 'error', 'OWNERSHIP_MISMATCH', 'error_code', 'TASK_OWNERSHIP_MISMATCH');
  end if;

  if v_res.lease_token is null or v_res.lease_token <> v_token then
    return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN');
  end if;

  -- Clear execution lease while preserving processing status for subsequent chunks
  update public.ai_trial_reservations
  set lease_expires_at = now(),
      lease_token = null,
      last_lease_token = v_token
  where task_id = p_task_id
    and lease_token = v_token;

  return jsonb_build_object('success', true, 'status', 'intermediate_cleared');
end;
$$;

revoke all on function public.clear_ai_task_lease(text, uuid, text) from public, anon, authenticated;
grant execute on function public.clear_ai_task_lease(text, uuid, text) to service_role;

-- 4. Authoritative DB Usage Aggregation RPC (Independent of pagination limits)
create or replace function public.aggregate_ai_usage_telemetry(
  p_user_id text default null,
  p_task_type text default null,
  p_credit_source text default null,
  p_model text default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_total_requests integer := 0;
  v_successful_requests integer := 0;
  v_failed_requests integer := 0;
  v_failure_rate numeric := 0;
  v_total_cost_usd numeric := 0;
  v_total_cost_krw numeric := 0;

  v_op_requests integer := 0;
  v_op_tokens bigint := 0;
  v_op_cost_usd numeric := 0;
  v_op_cost_krw numeric := 0;

  v_pk_requests integer := 0;
  v_pk_tokens bigint := 0;
  v_pk_cost_usd numeric := 0;
  v_pk_cost_krw numeric := 0;

  v_requests_by_task jsonb := '{}'::jsonb;
  v_tokens_by_model jsonb := '{}'::jsonb;
  v_cost_by_model jsonb := '{}'::jsonb;
  v_daily_metrics jsonb := '[]'::jsonb;
  v_anomalies jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'error_code', 'UNAUTHORIZED',
      'message', 'service_role 권한이 필요합니다.'
    );
  end if;

  -- Total, success, failure, and cost sums
  select
    count(*)::integer,
    coalesce(sum(case when status = 'success' then 1 else 0 end), 0)::integer,
    coalesce(sum(case when status <> 'success' then 1 else 0 end), 0)::integer,
    coalesce(sum(estimated_cost_usd), 0)::numeric,
    coalesce(sum(estimated_cost_krw), 0)::numeric,
    -- operator_trial consumption
    coalesce(sum(case when credit_source = 'operator_trial' then 1 else 0 end), 0)::integer,
    coalesce(sum(case when credit_source = 'operator_trial' then total_tokens else 0 end), 0)::bigint,
    coalesce(sum(case when credit_source = 'operator_trial' then estimated_cost_usd else 0 end), 0)::numeric,
    coalesce(sum(case when credit_source = 'operator_trial' then estimated_cost_krw else 0 end), 0)::numeric,
    -- personal_key consumption
    coalesce(sum(case when credit_source = 'personal_key' then 1 else 0 end), 0)::integer,
    coalesce(sum(case when credit_source = 'personal_key' then total_tokens else 0 end), 0)::bigint,
    coalesce(sum(case when credit_source = 'personal_key' then estimated_cost_usd else 0 end), 0)::numeric,
    coalesce(sum(case when credit_source = 'personal_key' then estimated_cost_krw else 0 end), 0)::numeric
  into
    v_total_requests,
    v_successful_requests,
    v_failed_requests,
    v_total_cost_usd,
    v_total_cost_krw,
    v_op_requests,
    v_op_tokens,
    v_op_cost_usd,
    v_op_cost_krw,
    v_pk_requests,
    v_pk_tokens,
    v_pk_cost_usd,
    v_pk_cost_krw
  from public.ai_usage_telemetry
  where (p_user_id is null or user_id = p_user_id)
    and (p_task_type is null or task_type = p_task_type)
    and (p_credit_source is null or credit_source = p_credit_source)
    and (p_model is null or model = p_model)
    and (p_start_date is null or created_at >= p_start_date)
    and (p_end_date is null or created_at <= p_end_date);

  if v_total_requests > 0 then
    v_failure_rate := round((v_failed_requests::numeric / v_total_requests::numeric) * 10000) / 100;
  end if;

  -- Requests by task breakdown
  select coalesce(jsonb_object_agg(task_type, cnt), '{}'::jsonb)
  into v_requests_by_task
  from (
    select task_type, count(*)::integer as cnt
    from public.ai_usage_telemetry
    where (p_user_id is null or user_id = p_user_id)
      and (p_task_type is null or task_type = p_task_type)
      and (p_credit_source is null or credit_source = p_credit_source)
      and (p_model is null or model = p_model)
      and (p_start_date is null or created_at >= p_start_date)
      and (p_end_date is null or created_at <= p_end_date)
    group by task_type
  ) t;

  -- Tokens and Cost by model breakdown
  select
    coalesce(jsonb_object_agg(model, jsonb_build_object(
      'input', input_sum,
      'output', output_sum,
      'total', total_sum
    )), '{}'::jsonb),
    coalesce(jsonb_object_agg(model, jsonb_build_object(
      'usd', round(cost_usd_sum::numeric, 6),
      'krw', round(cost_krw_sum::numeric, 2)
    )), '{}'::jsonb)
  into v_tokens_by_model, v_cost_by_model
  from (
    select
      model,
      sum(input_tokens)::bigint as input_sum,
      sum(output_tokens)::bigint as output_sum,
      sum(total_tokens)::bigint as total_sum,
      sum(estimated_cost_usd)::numeric as cost_usd_sum,
      sum(estimated_cost_krw)::numeric as cost_krw_sum
    from public.ai_usage_telemetry
    where (p_user_id is null or user_id = p_user_id)
      and (p_task_type is null or task_type = p_task_type)
      and (p_credit_source is null or credit_source = p_credit_source)
      and (p_model is null or model = p_model)
      and (p_start_date is null or created_at >= p_start_date)
      and (p_end_date is null or created_at <= p_end_date)
    group by model
  ) m;

  -- Daily metrics breakdown
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', d_date,
    'requests', d_reqs,
    'totalTokens', d_tokens,
    'costUsd', round(d_cost_usd::numeric, 6),
    'costKrw', round(d_cost_krw::numeric, 2)
  ) order by d_date), '[]'::jsonb)
  into v_daily_metrics
  from (
    select
      to_char(created_at, 'YYYY-MM-DD') as d_date,
      count(*)::integer as d_reqs,
      sum(total_tokens)::bigint as d_tokens,
      sum(estimated_cost_usd)::numeric as d_cost_usd,
      sum(estimated_cost_krw)::numeric as d_cost_krw
    from public.ai_usage_telemetry
    where (p_user_id is null or user_id = p_user_id)
      and (p_task_type is null or task_type = p_task_type)
      and (p_credit_source is null or credit_source = p_credit_source)
      and (p_model is null or model = p_model)
      and (p_start_date is null or created_at >= p_start_date)
      and (p_end_date is null or created_at <= p_end_date)
    group by to_char(created_at, 'YYYY-MM-DD')
  ) d;

  -- User anomaly detection (> 100 requests or > 500k tokens in filtered range)
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', anom_user::text,
    'reason', case when anom_count > 100 then '단기간 비정상 대량 요청 감지 (요청 100건 초과)' else '비정상 대용량 토큰 소비 감지 (50만 토큰 초과)' end,
    'requestCount', anom_count,
    'totalTokens', anom_tokens,
    'period', 'recorded_window'
  )), '[]'::jsonb)
  into v_anomalies
  from (
    select
      user_id as anom_user,
      count(*)::integer as anom_count,
      sum(total_tokens)::bigint as anom_tokens
    from public.ai_usage_telemetry
    where (p_user_id is null or user_id = p_user_id)
      and (p_task_type is null or task_type = p_task_type)
      and (p_credit_source is null or credit_source = p_credit_source)
      and (p_model is null or model = p_model)
      and (p_start_date is null or created_at >= p_start_date)
      and (p_end_date is null or created_at <= p_end_date)
    group by user_id
    having count(*) > 100 or sum(total_tokens) > 500000
  ) a;

  return jsonb_build_object(
    'totalRequests', v_total_requests,
    'successfulRequests', v_successful_requests,
    'failedRequests', v_failed_requests,
    'failureRatePercent', v_failure_rate,
    'requestsByTask', v_requests_by_task,
    'tokensByModel', v_tokens_by_model,
    'costByModel', v_cost_by_model,
    'totalCostUsd', round(v_total_cost_usd, 6),
    'totalCostKrw', round(v_total_cost_krw, 2),
    'operatorTrialConsumption', jsonb_build_object(
      'requests', v_op_requests,
      'tokens', v_op_tokens,
      'estimatedCostUsd', round(v_op_cost_usd, 6),
      'estimatedCostKrw', round(v_op_cost_krw, 2)
    ),
    'personalKeyConsumption', jsonb_build_object(
      'requests', v_pk_requests,
      'tokens', v_pk_tokens,
      'estimatedCostUsd', round(v_pk_cost_usd, 6),
      'estimatedCostKrw', round(v_pk_cost_krw, 2)
    ),
    'dailyMetrics', v_daily_metrics,
    'anomalies', v_anomalies
  );
end;
$$;

revoke all on function public.aggregate_ai_usage_telemetry(text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.aggregate_ai_usage_telemetry(text, text, text, text, timestamptz, timestamptz) to service_role;
