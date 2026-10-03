-- ============================================================================
-- Approval integrity + problem revision.
--
--  * approve_concept_draft / approve_problem_draft now validate the submitted
--    document against the SERVER draft (subject + concept links), and reject an
--    id that already belongs to a different entity (no blind ON CONFLICT DO
--    NOTHING success).
--  * revise_problem atomically writes a new immutable version (archives the old
--    one) and refreshes links, guarded by the expected version.
-- ============================================================================

create or replace function public.approve_concept_draft(
  p_draft_id text,
  p_expected_updated_at timestamptz,
  p_concept jsonb
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  d public.concept_drafts%rowtype;
  v_concept_id text;
begin
  select * into d from public.concept_drafts
    where id = p_draft_id and user_id = auth.uid()
    for update;
  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.approved_concept_id is not null then
    return d.approved_concept_id;
  end if;
  if d.is_approved or d.status <> 'draft' then
    raise exception 'DRAFT_NOT_PENDING';
  end if;
  if p_expected_updated_at is not null and d.updated_at <> p_expected_updated_at then
    raise exception 'DRAFT_STALE' using errcode = 'P0001';
  end if;

  -- The submitted document must agree with the authoritative server draft.
  if coalesce(p_concept->>'subjectId', '') <> d.subject_id
     or (p_concept ? 'draftId' and coalesce(p_concept->>'draftId', '') <> d.id) then
    raise exception 'DRAFT_SCOPE_MISMATCH';
  end if;

  v_concept_id := coalesce(nullif(p_concept->>'id', ''), d.id);
  insert into public.concepts (
    id, user_id, subject_id, title, order_index, status, current_score,
    is_learned, is_demo, version, draft_id, payload
  ) values (
    v_concept_id, auth.uid(), d.subject_id,
    coalesce(p_concept->>'title', d.title),
    coalesce((p_concept->>'order')::int, 0),
    coalesce(p_concept->>'status', 'unstudied'),
    coalesce((p_concept->>'currentScore')::numeric, 0),
    coalesce((p_concept->>'isLearned')::boolean, false),
    false, 1, d.id, p_concept
  )
  on conflict (id, user_id) do nothing;

  -- The id must now belong to THIS draft; otherwise it collided with another entity.
  if not exists (
    select 1 from public.concepts c
    where c.id = v_concept_id and c.user_id = auth.uid() and c.draft_id = d.id
  ) then
    raise exception 'ENTITY_ID_CONFLICT' using errcode = 'P0001';
  end if;

  update public.concept_drafts
    set status = 'approved', is_approved = true, approved_concept_id = v_concept_id,
        approval_state = 'approved', approval_error = null, updated_at = now()
    where id = p_draft_id and user_id = auth.uid();

  return v_concept_id;
end;
$$;

create or replace function public.approve_problem_draft(
  p_draft_id text,
  p_expected_updated_at timestamptz,
  p_problem jsonb
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  d public.problem_drafts%rowtype;
  v_problem_id text;
  v_rubric_sum numeric;
  v_concept_count integer;
  v_concept_id text;
  v_position integer := 0;
  v_client_concepts jsonb;
  v_draft_concepts jsonb;
begin
  select * into d from public.problem_drafts
    where id = p_draft_id and user_id = auth.uid()
    for update;
  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.approved_problem_id is not null then
    return d.approved_problem_id;
  end if;
  if d.is_approved or d.status <> 'draft' then
    raise exception 'DRAFT_NOT_PENDING';
  end if;
  if p_expected_updated_at is not null and d.updated_at <> p_expected_updated_at then
    raise exception 'DRAFT_STALE' using errcode = 'P0001';
  end if;

  if coalesce(length(trim(p_problem->>'title')), 0) = 0
     or coalesce(length(trim(p_problem->>'promptText')), 0) = 0
     or coalesce(length(trim(p_problem->>'modelAnswer')), 0) = 0 then
    raise exception 'DRAFT_INCOMPLETE';
  end if;

  select coalesce(sum((c->>'maxScore')::numeric), 0) into v_rubric_sum
    from jsonb_array_elements(coalesce(p_problem->'rubric', '[]'::jsonb)) c;
  if v_rubric_sum <> 100 then
    raise exception 'RUBRIC_NOT_100';
  end if;

  select count(*) into v_concept_count
    from jsonb_array_elements_text(coalesce(p_problem->'conceptIds', '[]'::jsonb));
  if v_concept_count = 0 then
    raise exception 'NO_CONCEPT_LINK';
  end if;

  -- The submitted document must agree with the authoritative server draft.
  if coalesce(p_problem->>'subjectId', '') <> d.subject_id then
    raise exception 'DRAFT_SCOPE_MISMATCH';
  end if;
  v_client_concepts := (
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb)
    from jsonb_array_elements_text(coalesce(p_problem->'conceptIds', '[]'::jsonb)) x
  );
  v_draft_concepts := (
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb)
    from jsonb_array_elements_text(coalesce(d.payload->'conceptIds', '[]'::jsonb)) x
  );
  if v_client_concepts <> v_draft_concepts then
    raise exception 'DRAFT_SCOPE_MISMATCH';
  end if;

  v_problem_id := coalesce(nullif(p_problem->>'id', ''), d.id);
  insert into public.problems (
    id, user_id, subject_id, title, type, is_approved, is_outdated,
    needs_source_review, quality_status, version, draft_id, is_transfer,
    source_problem_id, logic_session_id, is_demo, payload
  ) values (
    v_problem_id, auth.uid(), d.subject_id,
    coalesce(p_problem->>'title', d.title),
    coalesce(p_problem->>'type', d.type),
    true, false, false, 'normal', 1, d.id,
    coalesce((p_problem->>'isTransfer')::boolean, false),
    nullif(p_problem->>'sourceProblemId', ''),
    nullif(p_problem->>'logicSessionId', ''),
    false, p_problem
  )
  on conflict (id, user_id) do nothing;

  if not exists (
    select 1 from public.problems p
    where p.id = v_problem_id and p.user_id = auth.uid() and p.draft_id = d.id
  ) then
    raise exception 'ENTITY_ID_CONFLICT' using errcode = 'P0001';
  end if;

  for v_concept_id in select jsonb_array_elements_text(coalesce(p_problem->'conceptIds', '[]'::jsonb)) loop
    insert into public.problem_concepts (problem_id, concept_id, subject_id, user_id, position)
    values (v_problem_id, v_concept_id, d.subject_id, auth.uid(), v_position)
    on conflict (problem_id, concept_id, user_id) do nothing;
    v_position := v_position + 1;
  end loop;

  insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
  values (auth.uid(), v_problem_id, d.subject_id, 1, p_problem)
  on conflict (problem_id, version, user_id) do nothing;

  update public.problem_drafts
    set status = 'approved', is_approved = true, approved_problem_id = v_problem_id,
        approval_state = 'approved', approval_error = null, updated_at = now()
    where id = p_draft_id and user_id = auth.uid();

  return v_problem_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- revise_problem: transactional new-version write with immutable history.
-- ---------------------------------------------------------------------------
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
  if coalesce(p_problem->>'subjectId', '') <> pr.subject_id then
    raise exception 'DRAFT_SCOPE_MISMATCH';
  end if;

  -- Evaluation-affecting fields only (metadata changes do not bump a version).
  v_same :=
    coalesce(p_problem->>'title', '') = coalesce(pr.payload->>'title', '')
    and coalesce(p_problem->>'promptText', '') = coalesce(pr.payload->>'promptText', '')
    and coalesce(p_problem->>'modelAnswer', '') = coalesce(pr.payload->>'modelAnswer', '')
    and coalesce(p_problem->'rubric', '[]'::jsonb) = coalesce(pr.payload->'rubric', '[]'::jsonb)
    and coalesce(p_problem->'hints', '[]'::jsonb) = coalesce(pr.payload->'hints', '[]'::jsonb)
    and coalesce(p_problem->>'appliedConditionNote', '') = coalesce(pr.payload->>'appliedConditionNote', '');

  if v_same then
    -- No evaluation change: refresh metadata/quality without a new version.
    update public.problems set
      payload = p_problem,
      is_outdated = coalesce((p_problem->>'isOutdated')::boolean, is_outdated),
      needs_source_review = coalesce((p_problem->>'needsSourceReview')::boolean, needs_source_review),
      quality_status = coalesce(p_problem->>'qualityStatus', quality_status),
      updated_at = now()
    where id = p_problem_id and user_id = auth.uid();
    return pr.version;
  end if;

  v_new_version := pr.version + 1;

  -- Archive the old version (immutable).
  insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
  values (auth.uid(), p_problem_id, pr.subject_id, pr.version, pr.payload)
  on conflict (problem_id, version, user_id) do nothing;

  update public.problems set
    version = v_new_version,
    payload = p_problem,
    title = coalesce(p_problem->>'title', title),
    type = coalesce(p_problem->>'type', type),
    is_outdated = coalesce((p_problem->>'isOutdated')::boolean, false),
    needs_source_review = coalesce((p_problem->>'needsSourceReview')::boolean, false),
    quality_status = coalesce(p_problem->>'qualityStatus', 'normal'),
    updated_at = now()
  where id = p_problem_id and user_id = auth.uid();

  -- Archive the new version.
  insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
  values (auth.uid(), p_problem_id, pr.subject_id, v_new_version, p_problem)
  on conflict (problem_id, version, user_id) do nothing;

  -- Refresh concept links (same user + subject enforced by composite FK).
  delete from public.problem_concepts where problem_id = p_problem_id and user_id = auth.uid();
  for v_concept_id in select jsonb_array_elements_text(coalesce(p_problem->'conceptIds', '[]'::jsonb)) loop
    insert into public.problem_concepts (problem_id, concept_id, subject_id, user_id, position)
    values (p_problem_id, v_concept_id, pr.subject_id, auth.uid(), v_position)
    on conflict (problem_id, concept_id, user_id) do nothing;
    v_position := v_position + 1;
  end loop;

  return v_new_version;
end;
$$;
