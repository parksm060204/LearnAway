-- Migration 20260101000029: Settle and Release RPC Retry Idempotent Recovery
--
-- Fixes STALE_LEASE_TOKEN failure on network drop & retry:
-- 1. Adds `last_lease_token` column to `public.ai_trial_reservations`.
-- 2. Checks completed status before clearing/checking active lease token so that:
--    - Re-settle with the same token returns read-only success without error or re-deduction.
--    - Re-release with the same token returns read-only success without error or double refund.
--    - Stale token from earlier executions or cross-user requests are strictly rejected.
--    - Unfinished tasks still require a valid, matching active `lease_token`.
--    - Refund of settled tasks and uncredited settle of refunded tasks remain blocked.

-- 1. Add last_lease_token to public.ai_trial_reservations
alter table public.ai_trial_reservations
  add column if not exists last_lease_token text;

-- 2. Update settle_trial_credit
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

  -- 1. Idempotency Check: if already settled, verify identity and return read-only success
  if v_res.status = 'settled' then
    if v_res.last_lease_token is not null and v_res.last_lease_token <> v_token then
      return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN', 'message', '유효하지 않거나 만료된 실행 토큰입니다.');
    end if;
    if v_res.last_lease_token is null and v_res.lease_token is not null and v_res.lease_token <> v_token then
      return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN', 'message', '유효하지 않거나 만료된 실행 토큰입니다.');
    end if;
    return jsonb_build_object('success', true, 'status', 'settled', 'message', '이미 확정된 작업입니다.');
  end if;

  -- 2. Refunded task guard: cannot settle without re-reservation
  if v_res.status in ('released', 'failed_refunded') then
    return jsonb_build_object('success', false, 'error', 'ALREADY_REFUNDED', 'error_code', 'ALREADY_REFUNDED', 'message', '이미 환급된 작업은 재차감 없이 확정할 수 없습니다.');
  end if;

  -- 3. Strict active lease token check for unfinalized tasks
  if v_res.lease_token is null or v_res.lease_token <> v_token then
    return jsonb_build_object('success', false, 'error', 'STALE_LEASE_TOKEN', 'error_code', 'STALE_LEASE_TOKEN', 'message', '유효하지 않거나 만료된 실행 토큰입니다.');
  end if;

  -- 4. Cached result guard: cannot settle without preserved AI output
  if v_res.cached_result is null then
    return jsonb_build_object('success', false, 'error', 'MISSING_CACHED_RESULT', 'error_code', 'MISSING_CACHED_RESULT', 'message', '보존된 AI 결과가 없어 크레딧을 확정할 수 없습니다.');
  end if;

  -- 5. Atomic state transition
  update public.ai_trial_reservations
  set status = 'settled',
      settled_at = coalesce(settled_at, now()),
      last_lease_token = v_token,
      lease_token = null,
      lease_expires_at = null
  where task_id = p_task_id
    and lease_token = v_token;

  return jsonb_build_object('success', true, 'status', 'settled');
end;
$$;

revoke all on function public.settle_trial_credit(text, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_trial_credit(text, uuid, text) to service_role;

-- 3. Update release_trial_credit
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

  -- 5. Atomic state transition and credit refund
  update public.ai_trial_reservations
  set status = 'failed_refunded',
      released_at = now(),
      release_reason = coalesce(p_reason, 'cancelled_or_failed'),
      last_lease_token = v_token,
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

revoke all on function public.release_trial_credit(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.release_trial_credit(text, text, uuid, text) to service_role;
