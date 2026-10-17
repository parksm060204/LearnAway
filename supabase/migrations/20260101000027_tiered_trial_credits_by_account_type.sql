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
-- 5. Atomic server-side execution:
--    Managed exclusively via get_or_create_trial_credits() with strict SECURITY DEFINER.
-- ==============================================================================

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
  v_is_guest boolean := false;
  v_initial_grant integer := 3;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  -- 1. Check if record already exists to preserve existing balances and prevent duplicate grants
  select granted_credits, balance into v_granted, v_balance
  from public.ai_trial_credits
  where user_id = v_uid;

  if v_granted is null then
    -- 2. New user: determine account tier
    -- Guest accounts:
    --   a. Linked in public.username_accounts table
    --   b. Or auth.users raw_user_meta_data->>'auth_type' = 'username'
    --   c. Or synthetic email ending with '@id.learnaway.local'
    select exists (
      select 1 from public.username_accounts where user_id = v_uid
    ) into v_is_guest;

    if not v_is_guest then
      select exists (
        select 1 from auth.users
        where id = v_uid
          and (
            (raw_user_meta_data->>'auth_type') = 'username'
            or email like '%@id.learnaway.local'
          )
      ) into v_is_guest;
    end if;

    -- Tiered initial credit policy: Guest = 1, General = 3
    if v_is_guest then
      v_initial_grant := 1;
    else
      v_initial_grant := 3;
    end if;

    -- Atomic insert with conflict protection (handles concurrent first-requests safely)
    insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
    values (v_uid, v_initial_grant, v_initial_grant, now(), now())
    on conflict (user_id) do nothing;

    -- Re-fetch committed row in case of concurrent insert race
    select granted_credits, balance into v_granted, v_balance
    from public.ai_trial_credits
    where user_id = v_uid;
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

-- Server-only overload accepting explicit p_user_id (for service_role background tasks & migrations)
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
  v_is_guest boolean := false;
  v_initial_grant integer := 3;
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
    select exists (
      select 1 from public.username_accounts where user_id = v_uid
    ) into v_is_guest;

    if not v_is_guest then
      select exists (
        select 1 from auth.users
        where id = v_uid
          and (
            (raw_user_meta_data->>'auth_type') = 'username'
            or email like '%@id.learnaway.local'
          )
      ) into v_is_guest;
    end if;

    if v_is_guest then
      v_initial_grant := 1;
    else
      v_initial_grant := 3;
    end if;

    insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
    values (v_uid, v_initial_grant, v_initial_grant, now(), now())
    on conflict (user_id) do nothing;

    select granted_credits, balance into v_granted, v_balance
    from public.ai_trial_credits
    where user_id = v_uid;
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

-- Enforce strict permission boundaries
revoke all on function public.get_or_create_trial_credits() from public, anon;
grant execute on function public.get_or_create_trial_credits() to authenticated, service_role;

revoke all on function public.get_or_create_trial_credits(uuid) from public, anon;
grant execute on function public.get_or_create_trial_credits(uuid) to authenticated, service_role;
