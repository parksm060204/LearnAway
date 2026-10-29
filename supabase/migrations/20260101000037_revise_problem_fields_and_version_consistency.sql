-- ============================================================================
-- Migration 37: Revise Problem Fields and Version Consistency
--
-- 1. Updates public.revise_problem v_same comparison to include:
--    - codeSnippet
--    - mathFormula
--    - timeStandardMinutes
--    - type
-- 2. Aligns problems.version, problems.payload->'version', and
--    problem_versions.snapshot->'version' to authoritative server version.
-- 3. Protects historical snapshots and prior attempts.
-- 4. Provides a diagnostic function to detect past version inconsistencies.
-- ============================================================================

create or replace function public.revise_problem(
  p_problem_id text,
  p_expected_version integer,
  p_problem jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  pr public.problems%rowtype;
  v_same boolean;
  v_new_version integer;
  v_concept_id text;
  v_position integer := 0;
  v_rubric_sum numeric;
  v_rubric_count integer;
  v_bad_rubric_count integer;
  v_concept_count integer;
  v_payload jsonb;
  v_prior_payload jsonb;
begin
  select * into pr from public.problems
    where id = p_problem_id and user_id = auth.uid()
    for update;
  if not found then
    raise exception 'PROBLEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if pr.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if p_problem is null or jsonb_typeof(p_problem) <> 'object'
     or coalesce(length(trim(p_problem->>'title')), 0) = 0
     or coalesce(length(trim(p_problem->>'promptText')), 0) = 0
     or coalesce(length(trim(p_problem->>'modelAnswer')), 0) = 0 then
    raise exception 'PROBLEM_INCOMPLETE' using errcode = 'P0001';
  end if;
  if coalesce(p_problem->>'subjectId', '') <> pr.subject_id then
    raise exception 'DRAFT_SCOPE_MISMATCH' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_problem->'rubric') is distinct from 'array' then
    raise exception 'RUBRIC_INVALID' using errcode = 'P0001';
  end if;
  select count(*), coalesce(sum((x.item->>'maxScore')::numeric), 0),
         count(*) filter (where jsonb_typeof(x.item) is distinct from 'object'
           or coalesce(x.item->>'id', '') = ''
           or jsonb_typeof(x.item->'maxScore') is distinct from 'number'
           or coalesce((x.item->>'maxScore')::numeric, 0) <= 0)
    into v_rubric_count, v_rubric_sum, v_bad_rubric_count
    from jsonb_array_elements(p_problem->'rubric') as x(item);
  if v_rubric_count = 0 or v_bad_rubric_count > 0 or v_rubric_sum <> 100
     or (select count(distinct x.item->>'id') from jsonb_array_elements(p_problem->'rubric') as x(item)) <> v_rubric_count then
    raise exception 'RUBRIC_NOT_100' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_problem->'conceptIds') is distinct from 'array' then
    raise exception 'NO_CONCEPT_LINK' using errcode = 'P0001';
  end if;
  select count(*) into v_concept_count
    from jsonb_array_elements_text(p_problem->'conceptIds') as x(id);
  if v_concept_count = 0 or v_concept_count <>
     (select count(distinct x.id) from jsonb_array_elements_text(p_problem->'conceptIds') as x(id)) then
    raise exception 'NO_CONCEPT_LINK' using errcode = 'P0001';
  end if;

  -- Comprehensive semantic equality check including codeSnippet, mathFormula, and timeStandardMinutes
  v_same :=
    coalesce(p_problem->>'title', '') = coalesce(pr.payload->>'title', '')
    and coalesce(p_problem->>'promptText', '') = coalesce(pr.payload->>'promptText', '')
    and coalesce(p_problem->>'modelAnswer', '') = coalesce(pr.payload->>'modelAnswer', '')
    and coalesce(p_problem->'rubric', '[]'::jsonb) = coalesce(pr.payload->'rubric', '[]'::jsonb)
    and coalesce(p_problem->'hints', '[]'::jsonb) = coalesce(pr.payload->'hints', '[]'::jsonb)
    and coalesce(p_problem->'conceptIds', '[]'::jsonb) = coalesce(pr.payload->'conceptIds', '[]'::jsonb)
    and coalesce(p_problem->>'appliedConditionNote', '') = coalesce(pr.payload->>'appliedConditionNote', '')
    and coalesce(p_problem->>'mathFormula', '') = coalesce(pr.payload->>'mathFormula', '')
    and coalesce(p_problem->>'codeSnippet', '') = coalesce(pr.payload->>'codeSnippet', '')
    and coalesce((p_problem->>'timeStandardMinutes')::numeric, 0) = coalesce((pr.payload->>'timeStandardMinutes')::numeric, 0)
    and coalesce(p_problem->>'type', '') = coalesce(pr.payload->>'type', pr.type, '');

  if v_same then
    -- Idempotent retry: align payload version to existing pr.version
    v_payload := jsonb_set(p_problem, '{version}', to_jsonb(pr.version));
    update public.problems set
      payload = v_payload,
      is_outdated = coalesce((p_problem->>'isOutdated')::boolean, is_outdated),
      needs_source_review = coalesce((p_problem->>'needsSourceReview')::boolean, needs_source_review),
      quality_status = coalesce(p_problem->>'qualityStatus', quality_status),
      updated_at = now()
    where id = p_problem_id and user_id = auth.uid();
    return pr.version;
  end if;

  v_new_version := pr.version + 1;

  -- Ensure prior version snapshot exists in problem_versions without mutating existing records
  v_prior_payload := jsonb_set(pr.payload, '{version}', to_jsonb(pr.version));
  insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
  values (auth.uid(), p_problem_id, pr.subject_id, pr.version, v_prior_payload)
  on conflict (problem_id, version, user_id) do nothing;

  -- Ensure new version payload has version set to v_new_version
  v_payload := jsonb_set(p_problem, '{version}', to_jsonb(v_new_version));

  update public.problems set
    version = v_new_version,
    payload = v_payload,
    title = p_problem->>'title',
    type = coalesce(p_problem->>'type', type),
    is_outdated = coalesce((p_problem->>'isOutdated')::boolean, false),
    needs_source_review = coalesce((p_problem->>'needsSourceReview')::boolean, false),
    quality_status = coalesce(p_problem->>'qualityStatus', 'normal'),
    updated_at = now()
  where id = p_problem_id and user_id = auth.uid();

  -- Insert new version snapshot with aligned version
  insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
  values (auth.uid(), p_problem_id, pr.subject_id, v_new_version, v_payload)
  on conflict (problem_id, version, user_id) do nothing;

  delete from public.problem_concepts where problem_id = p_problem_id and user_id = auth.uid();
  for v_concept_id in select x.id from jsonb_array_elements_text(p_problem->'conceptIds') as x(id) loop
    insert into public.problem_concepts (problem_id, concept_id, subject_id, user_id, position)
    values (p_problem_id, v_concept_id, pr.subject_id, auth.uid(), v_position)
    on conflict (problem_id, concept_id, user_id) do nothing;
    v_position := v_position + 1;
  end loop;

  return v_new_version;
end;
$$;

-- Diagnostic helper to detect historical version inconsistencies without mutating data
create or replace function public.detect_problem_version_inconsistencies()
returns table (
  problem_id text,
  user_id uuid,
  row_version integer,
  payload_version integer,
  issue_type text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id as problem_id,
    p.user_id,
    p.version as row_version,
    (p.payload->>'version')::integer as payload_version,
    case
      when p.payload->>'version' is null then 'PAYLOAD_VERSION_MISSING'
      when p.version <> (p.payload->>'version')::integer then 'ROW_PAYLOAD_VERSION_MISMATCH'
      else 'OK'
    end as issue_type
  from public.problems p
  where p.payload->>'version' is null
     or p.version <> (p.payload->>'version')::integer;
$$;

-- Grant execution to authenticated users for revise_problem and service_role for diagnostics
grant execute on function public.revise_problem(text, integer, jsonb) to authenticated;
grant execute on function public.detect_problem_version_inconsistencies() to service_role;
