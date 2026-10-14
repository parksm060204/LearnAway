-- Migration 20260101000014: Review Notification Dispatch Control, Status Integrity, and Atomic Claim
-- Ensures atomic claiming before external provider call, retry on failure, and distinct delivery states.

-- 1. Update status constraint on review_notification_logs to reflect real delivery lifecycle
alter table public.review_notification_logs drop constraint if exists review_notification_logs_status_check;
alter table public.review_notification_logs
  add constraint review_notification_logs_status_check
  check (status in ('queued', 'sending', 'accepted', 'delivered', 'failed', 'suppressed'));

-- 2. Atomically claim a dispatch slot before invoking external webhook / provider
create or replace function public.claim_notification_dispatch(
  p_user_id uuid,
  p_idempotency_key text,
  p_channel text,
  p_due_item_count integer,
  p_message text,
  p_is_test boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.review_notification_subscriptions%rowtype;
  v_log public.review_notification_logs%rowtype;
begin
  -- Authenticate caller if executing in user context
  if auth.uid() is not null and auth.uid() <> p_user_id then
    return jsonb_build_object('allowed', false, 'reason', 'FORBIDDEN_USER_MISMATCH');
  end if;

  -- 1. Check user subscription and active consent
  select * into v_sub
  from public.review_notification_subscriptions
  where user_id = p_user_id and channel = p_channel and is_active = true;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'ACTIVE_SUBSCRIPTION_NOT_FOUND');
  end if;

  if v_sub.target is null or length(trim(v_sub.target)) = 0 then
    return jsonb_build_object('allowed', false, 'reason', 'TARGET_NOT_CONFIGURED');
  end if;

  -- 2. Check if a log with this idempotency key already exists
  select * into v_log
  from public.review_notification_logs
  where idempotency_key = p_idempotency_key;

  if found then
    if v_log.status in ('sending', 'queued', 'accepted', 'delivered') then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'ALREADY_DISPATCHED_OR_IN_FLIGHT',
        'status', v_log.status,
        'log_id', v_log.id
      );
    end if;

    -- If existing log failed, allow controlled retry by resetting to sending
    update public.review_notification_logs
    set status = 'sending',
        error = null,
        created_at = now()
    where id = v_log.id
    returning * into v_log;

    return jsonb_build_object(
      'allowed', true,
      'log_id', v_log.id,
      'target', v_sub.target,
      'channel', v_sub.channel,
      'is_retry', true
    );
  end if;

  -- 3. Atomic reservation: insert with status 'sending'
  insert into public.review_notification_logs (
    user_id,
    subscription_id,
    idempotency_key,
    channel,
    status,
    due_item_count,
    message,
    created_at
  ) values (
    p_user_id,
    v_sub.id,
    p_idempotency_key,
    p_channel,
    'sending',
    greatest(0, p_due_item_count),
    p_message,
    now()
  ) returning * into v_log;

  return jsonb_build_object(
    'allowed', true,
    'log_id', v_log.id,
    'target', v_sub.target,
    'channel', v_sub.channel,
    'is_retry', false
  );
exception
  when unique_violation then
    return jsonb_build_object('allowed', false, 'reason', 'CONCURRENT_DISPATCH_CONFLICT');
end;
$$;

revoke all on function public.claim_notification_dispatch(uuid, text, text, integer, text, boolean) from anon;
grant execute on function public.claim_notification_dispatch(uuid, text, text, integer, text, boolean) to authenticated, service_role;

-- 3. Complete dispatch after external provider response
create or replace function public.complete_notification_dispatch(
  p_log_id uuid,
  p_status text,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.review_notification_logs%rowtype;
begin
  if p_status not in ('accepted', 'delivered', 'failed', 'suppressed') then
    return jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  end if;

  select * into v_log from public.review_notification_logs where id = p_log_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'LOG_NOT_FOUND');
  end if;

  if auth.uid() is not null and auth.uid() <> v_log.user_id then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN_USER_MISMATCH');
  end if;

  update public.review_notification_logs
  set status = p_status,
      error = p_error,
      delivered_at = case when p_status in ('delivered', 'accepted') then now() else null end
  where id = p_log_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.complete_notification_dispatch(uuid, text, text) from anon;
grant execute on function public.complete_notification_dispatch(uuid, text, text) to authenticated, service_role;
