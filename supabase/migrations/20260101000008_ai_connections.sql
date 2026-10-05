-- ============================================================================
-- Per-user AI API connection (Incheon National University AI:NU BAZE Gateway).
--
-- The user's API key is encrypted on the server (AES-256-GCM) before it ever
-- reaches the database. Secret columns are NOT selectable by anon/authenticated
-- roles; only a SECURITY DEFINER function can read them, and only for the
-- calling user. Clients read safe metadata columns only.
--
-- The Gateway base URL is fixed by the server; a stored base_url is kept for
-- audit/display but is never used to build requests.
-- ============================================================================

create table if not exists public.ai_connections (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  provider text not null default 'school_gateway',
  base_url text not null,
  model text not null,
  key_hint text not null default '',
  status text not null default 'connected'
    check (status in ('connected', 'check_failed')),
  api_key_ciphertext text not null,
  api_key_iv text not null,
  api_key_tag text not null,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_connections enable row level security;

drop policy if exists ai_connections_select_own on public.ai_connections;
drop policy if exists ai_connections_insert_own on public.ai_connections;
drop policy if exists ai_connections_update_own on public.ai_connections;
drop policy if exists ai_connections_delete_own on public.ai_connections;
create policy ai_connections_select_own on public.ai_connections
  for select using (auth.uid() = user_id);

drop trigger if exists ai_connections_set_updated_at on public.ai_connections;
create trigger ai_connections_set_updated_at before update on public.ai_connections
  for each row execute function public.set_updated_at();

-- Secret columns must never be reachable through the REST API. Column-level
-- privileges: authenticated may read only the safe columns, and may not write
-- the table directly (all writes go through the SECURITY DEFINER RPC below).
revoke select on public.ai_connections from anon, authenticated;
grant select (user_id, provider, base_url, model, key_hint, status, last_checked_at, created_at, updated_at)
  on public.ai_connections to authenticated;
revoke insert, update, delete on public.ai_connections from anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_ai_connection: upsert the caller's encrypted key + metadata atomically.
-- ---------------------------------------------------------------------------
create or replace function public.save_ai_connection(
  p_provider text,
  p_base_url text,
  p_model text,
  p_key_hint text,
  p_ciphertext text,
  p_iv text,
  p_tag text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if coalesce(p_ciphertext, '') = '' or coalesce(p_iv, '') = '' or coalesce(p_tag, '') = '' then
    raise exception 'AI_CONNECTION_INCOMPLETE' using errcode = 'P0001';
  end if;

  insert into public.ai_connections (
    user_id, provider, base_url, model, key_hint, status,
    api_key_ciphertext, api_key_iv, api_key_tag, last_checked_at, updated_at
  ) values (
    v_uid, coalesce(nullif(p_provider, ''), 'school_gateway'),
    coalesce(p_base_url, ''), coalesce(p_model, ''), coalesce(p_key_hint, ''),
    'connected', p_ciphertext, p_iv, p_tag, now(), now()
  )
  on conflict (user_id) do update set
    provider = excluded.provider,
    base_url = excluded.base_url,
    model = excluded.model,
    key_hint = excluded.key_hint,
    status = 'connected',
    api_key_ciphertext = excluded.api_key_ciphertext,
    api_key_iv = excluded.api_key_iv,
    api_key_tag = excluded.api_key_tag,
    last_checked_at = now(),
    updated_at = now();

  return jsonb_build_object('user_id', v_uid, 'provider', p_provider, 'model', p_model, 'key_hint', p_key_hint);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_ai_connection_secret: returns the caller's encrypted key for server-side
-- decryption only. Never contains plaintext.
-- ---------------------------------------------------------------------------
create or replace function public.get_ai_connection_secret()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ai_connections%rowtype;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_row from public.ai_connections where user_id = v_uid;
  if v_row.user_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'provider', v_row.provider,
    'base_url', v_row.base_url,
    'model', v_row.model,
    'key_hint', v_row.key_hint,
    'ciphertext', v_row.api_key_ciphertext,
    'iv', v_row.api_key_iv,
    'tag', v_row.api_key_tag
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- touch_ai_connection: record a fresh check result without changing the key.
-- ---------------------------------------------------------------------------
create or replace function public.touch_ai_connection(p_status text, p_model text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  update public.ai_connections
    set status = case when p_status in ('connected', 'check_failed') then p_status else status end,
        model = coalesce(nullif(p_model, ''), model),
        last_checked_at = now(),
        updated_at = now()
    where user_id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_ai_connection: remove the encrypted key and the connection cache.
-- ---------------------------------------------------------------------------
create or replace function public.delete_ai_connection()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  delete from public.ai_connections where user_id = v_uid;
end;
$$;

revoke execute on function public.save_ai_connection(text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.get_ai_connection_secret() from public, anon;
revoke execute on function public.touch_ai_connection(text, text) from public, anon;
revoke execute on function public.delete_ai_connection() from public, anon;
grant execute on function public.save_ai_connection(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.get_ai_connection_secret() to authenticated;
grant execute on function public.touch_ai_connection(text, text) to authenticated;
grant execute on function public.delete_ai_connection() to authenticated;
