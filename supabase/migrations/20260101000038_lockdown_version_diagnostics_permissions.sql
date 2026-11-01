-- ==============================================================================
-- Migration 20260101000038: Lockdown Version Diagnostics RPC Execution Permissions
--
-- Fixes a privilege escalation / cross-tenant metadata disclosure issue in
-- Migration 20260101000037 where `public.detect_problem_version_inconsistencies()`
-- was defined as `SECURITY DEFINER` without revoking default `PUBLIC` execute
-- privileges, allowing `anon` and `authenticated` roles to list problem IDs and
-- user IDs across all users.
--
-- 1. Recreates `public.detect_problem_version_inconsistencies()` as a strictly
--    read-only operator diagnostic RPC with defense-in-depth role verification,
--    and explicitly revokes EXECUTE from `PUBLIC`, `anon`, and `authenticated`,
--    granting EXECUTE solely to `service_role`.
-- 2. Adds a separate user-scoped read-only diagnostic RPC
--    `public.detect_my_problem_version_inconsistencies()` that strictly enforces
--    `auth.uid()` server-side and revokes EXECUTE from `PUBLIC` and `anon`.
-- ==============================================================================

create or replace function public.detect_problem_version_inconsistencies()
returns table (
  problem_id text,
  user_id uuid,
  row_version integer,
  payload_version integer,
  issue_type text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  -- Defense-in-depth: reject if PostgREST JWT claim role is explicitly non-service_role
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') <> 'service_role' then
    raise exception 'FORBIDDEN: detect_problem_version_inconsistencies is restricted to service_role'
      using errcode = '42501';
  end if;

  return query
  -- 1. Row version vs payload.version mismatch or missing payload.version
  select
    p.id as problem_id,
    p.user_id,
    p.version as row_version,
    nullif(trim(p.payload->>'version'), '')::integer as payload_version,
    case
      when p.payload->>'version' is null then 'PAYLOAD_VERSION_MISSING'
      when p.version <> nullif(trim(p.payload->>'version'), '')::integer then 'ROW_PAYLOAD_VERSION_MISMATCH'
      else 'OK'
    end as issue_type
  from public.problems p
  where p.payload->>'version' is null
     or p.version <> nullif(trim(p.payload->>'version'), '')::integer

  union all

  -- 2. Current problem payload differs from its matching version snapshot in problem_versions
  select
    p.id as problem_id,
    p.user_id,
    p.version as row_version,
    nullif(trim(pv.snapshot->>'version'), '')::integer as payload_version,
    'CURRENT_SNAPSHOT_CONTENT_MISMATCH' as issue_type
  from public.problems p
  join public.problem_versions pv
    on pv.problem_id = p.id
   and pv.user_id = p.user_id
   and pv.version = p.version
  where
    coalesce(p.payload->>'title', '') <> coalesce(pv.snapshot->>'title', '')
    or coalesce(p.payload->>'promptText', '') <> coalesce(pv.snapshot->>'promptText', '')
    or coalesce(p.payload->>'modelAnswer', '') <> coalesce(pv.snapshot->>'modelAnswer', '')
    or coalesce(p.payload->'rubric', '[]'::jsonb) <> coalesce(pv.snapshot->'rubric', '[]'::jsonb)
    or coalesce(p.payload->'hints', '[]'::jsonb) <> coalesce(pv.snapshot->'hints', '[]'::jsonb)
    or coalesce(p.payload->'conceptIds', '[]'::jsonb) <> coalesce(pv.snapshot->'conceptIds', '[]'::jsonb)
    or coalesce(p.payload->>'appliedConditionNote', '') <> coalesce(pv.snapshot->>'appliedConditionNote', '')
    or coalesce(p.payload->>'mathFormula', '') <> coalesce(pv.snapshot->>'mathFormula', '')
    or coalesce(p.payload->>'codeSnippet', '') <> coalesce(pv.snapshot->>'codeSnippet', '')
    or coalesce(nullif(trim(p.payload->>'timeStandardMinutes'), '')::numeric, 0) <> coalesce(nullif(trim(pv.snapshot->>'timeStandardMinutes'), '')::numeric, 0)
    or coalesce(p.payload->>'type', p.type, '') <> coalesce(pv.snapshot->>'type', '')

  union all

  -- 3. Snapshot row version disagrees with snapshot->>'version'
  select
    pv.problem_id,
    pv.user_id,
    pv.version as row_version,
    nullif(trim(pv.snapshot->>'version'), '')::integer as payload_version,
    'SNAPSHOT_VERSION_MISMATCH' as issue_type
  from public.problem_versions pv
  where pv.snapshot->>'version' is not null
    and pv.version <> nullif(trim(pv.snapshot->>'version'), '')::integer

  union all

  -- 4. Problem at version > 1 missing its current version snapshot in problem_versions
  select
    p.id as problem_id,
    p.user_id,
    p.version as row_version,
    nullif(trim(p.payload->>'version'), '')::integer as payload_version,
    'MISSING_CURRENT_VERSION_SNAPSHOT' as issue_type
  from public.problems p
  where p.version > 1
    and not exists (
      select 1
      from public.problem_versions pv
      where pv.problem_id = p.id
        and pv.user_id = p.user_id
        and pv.version = p.version
    );
end;
$$;

revoke all on function public.detect_problem_version_inconsistencies() from public, anon, authenticated;
grant execute on function public.detect_problem_version_inconsistencies() to service_role;

-- User-scoped read-only diagnostic RPC: strictly enforces auth.uid() server-side
create or replace function public.detect_my_problem_version_inconsistencies()
returns table (
  problem_id text,
  user_id uuid,
  row_version integer,
  payload_version integer,
  issue_type text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null or coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') = 'anon' then
    raise exception 'UNAUTHENTICATED: detect_my_problem_version_inconsistencies requires an authenticated user'
      using errcode = '42501';
  end if;

  return query
  -- 1. Row version vs payload.version mismatch or missing payload.version (caller's rows only)
  select
    p.id as problem_id,
    p.user_id,
    p.version as row_version,
    nullif(trim(p.payload->>'version'), '')::integer as payload_version,
    case
      when p.payload->>'version' is null then 'PAYLOAD_VERSION_MISSING'
      when p.version <> nullif(trim(p.payload->>'version'), '')::integer then 'ROW_PAYLOAD_VERSION_MISMATCH'
      else 'OK'
    end as issue_type
  from public.problems p
  where p.user_id = v_uid
    and (
      p.payload->>'version' is null
      or p.version <> nullif(trim(p.payload->>'version'), '')::integer
    )

  union all

  -- 2. Current problem payload differs from its matching version snapshot in problem_versions (caller's rows only)
  select
    p.id as problem_id,
    p.user_id,
    p.version as row_version,
    nullif(trim(pv.snapshot->>'version'), '')::integer as payload_version,
    'CURRENT_SNAPSHOT_CONTENT_MISMATCH' as issue_type
  from public.problems p
  join public.problem_versions pv
    on pv.problem_id = p.id
   and pv.user_id = p.user_id
   and pv.version = p.version
  where p.user_id = v_uid
    and (
      coalesce(p.payload->>'title', '') <> coalesce(pv.snapshot->>'title', '')
      or coalesce(p.payload->>'promptText', '') <> coalesce(pv.snapshot->>'promptText', '')
      or coalesce(p.payload->>'modelAnswer', '') <> coalesce(pv.snapshot->>'modelAnswer', '')
      or coalesce(p.payload->'rubric', '[]'::jsonb) <> coalesce(pv.snapshot->'rubric', '[]'::jsonb)
      or coalesce(p.payload->'hints', '[]'::jsonb) <> coalesce(pv.snapshot->'hints', '[]'::jsonb)
      or coalesce(p.payload->'conceptIds', '[]'::jsonb) <> coalesce(pv.snapshot->'conceptIds', '[]'::jsonb)
      or coalesce(p.payload->>'appliedConditionNote', '') <> coalesce(pv.snapshot->>'appliedConditionNote', '')
      or coalesce(p.payload->>'mathFormula', '') <> coalesce(pv.snapshot->>'mathFormula', '')
      or coalesce(p.payload->>'codeSnippet', '') <> coalesce(pv.snapshot->>'codeSnippet', '')
      or coalesce(nullif(trim(p.payload->>'timeStandardMinutes'), '')::numeric, 0) <> coalesce(nullif(trim(pv.snapshot->>'timeStandardMinutes'), '')::numeric, 0)
      or coalesce(p.payload->>'type', p.type, '') <> coalesce(pv.snapshot->>'type', '')
    )

  union all

  -- 3. Snapshot row version disagrees with snapshot->>'version' (caller's rows only)
  select
    pv.problem_id,
    pv.user_id,
    pv.version as row_version,
    nullif(trim(pv.snapshot->>'version'), '')::integer as payload_version,
    'SNAPSHOT_VERSION_MISMATCH' as issue_type
  from public.problem_versions pv
  where pv.user_id = v_uid
    and pv.snapshot->>'version' is not null
    and pv.version <> nullif(trim(pv.snapshot->>'version'), '')::integer

  union all

  -- 4. Problem at version > 1 missing its current version snapshot in problem_versions (caller's rows only)
  select
    p.id as problem_id,
    p.user_id,
    p.version as row_version,
    nullif(trim(p.payload->>'version'), '')::integer as payload_version,
    'MISSING_CURRENT_VERSION_SNAPSHOT' as issue_type
  from public.problems p
  where p.user_id = v_uid
    and p.version > 1
    and not exists (
      select 1
      from public.problem_versions pv
      where pv.problem_id = p.id
        and pv.user_id = p.user_id
        and pv.version = p.version
    );
end;
$$;

revoke all on function public.detect_my_problem_version_inconsistencies() from public, anon;
grant execute on function public.detect_my_problem_version_inconsistencies() to authenticated, service_role;
