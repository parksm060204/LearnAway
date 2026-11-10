-- ==============================================================================
-- Migration 20260101000039: Problem Quality & Revision Concurrency Hardening
--
-- Fixes concurrency & data-preservation bugs in problem saving paths:
-- 1. Prevents quality/report updates from overwriting newer problem bodies,
--    model answers, rubrics, or versions (via both a transactional RPC
--    `public.update_problem_quality` and a BEFORE UPDATE trigger
--    `problems_enforce_update_integrity` on `public.problems`).
-- 2. Atomically merges concurrent problem reports and deduplicates retries so
--    neither tab's report nor concurrent body revisions are lost.
-- 3. Ensures `public.revise_problem` preserves concurrent reports across version
--    increments and keeps `problems.payload` and `problem_versions.snapshot`
--    strictly aligned, plus adds `public.revise_problem_with_snapshot` to return
--    the authoritative confirmed version and immutable snapshot in one transaction.
-- ==============================================================================

-- 1. Helper: Atomically merge and deduplicate problem reports
create or replace function public.merge_problem_reports(
  p_existing_reports jsonb,
  p_incoming_reports jsonb default null,
  p_add_report jsonb default null,
  p_dismiss_report jsonb default null,
  p_resolve_open boolean default false,
  p_resolution_note text default null,
  p_resolved_at text default null,
  p_new_quality_status text default null
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_reports jsonb;
  v_item jsonb;
  v_existing_item jsonb;
  v_idx integer;
  v_found boolean;
  v_is_dup boolean;
  v_now_iso text;
  v_dismiss_id text;
  v_dismiss_note text;
  v_dismiss_at text;
  v_resolve_note text;
  v_resolve_at text;
  v_next_reports jsonb;
begin
  v_now_iso := coalesce(
    nullif(trim(p_resolved_at), ''),
    to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  if p_existing_reports is not null and jsonb_typeof(p_existing_reports) = 'array' then
    v_reports := p_existing_reports;
  else
    v_reports := '[]'::jsonb;
  end if;

  -- Merge incoming reports array (e.g. from legacy caller or revise_problem) without losing existing reports
  if p_incoming_reports is not null and jsonb_typeof(p_incoming_reports) = 'array' then
    for v_item in select x.val from jsonb_array_elements(p_incoming_reports) as x(val) loop
      if jsonb_typeof(v_item) = 'object' and coalesce(trim(v_item->>'id'), '') <> '' then
        v_found := false;
        v_next_reports := '[]'::jsonb;
        for v_existing_item in select e.val from jsonb_array_elements(v_reports) as e(val) loop
          if coalesce(v_existing_item->>'id', '') = coalesce(v_item->>'id', '') then
            v_found := true;
            -- Allow status progression (open -> under_review -> resolved/dismissed), never regression
            if coalesce(v_existing_item->>'status', 'open') in ('open', 'under_review')
               and coalesce(v_item->>'status', 'open') in ('under_review', 'resolved', 'dismissed') then
              v_next_reports := v_next_reports || jsonb_build_array(v_existing_item || v_item);
            else
              v_next_reports := v_next_reports || jsonb_build_array(v_existing_item);
            end if;
          else
            v_next_reports := v_next_reports || jsonb_build_array(v_existing_item);
          end if;
        end loop;

        if v_found then
          v_reports := v_next_reports;
        else
          -- Check duplicate active report within 15 seconds (same type & trimmed details)
          v_is_dup := false;
          for v_existing_item in select e.val from jsonb_array_elements(v_reports) as e(val) loop
            if coalesce(v_existing_item->>'status', 'open') in ('open', 'under_review')
               and coalesce(v_existing_item->>'type', '') = coalesce(v_item->>'type', '')
               and trim(coalesce(v_existing_item->>'details', '')) = trim(coalesce(v_item->>'details', ''))
               and trim(coalesce(v_item->>'details', '')) <> '' then
              begin
                if abs(extract(epoch from (
                  coalesce(nullif(v_item->>'createdAt', '')::timestamptz, now()) -
                  coalesce(nullif(v_existing_item->>'createdAt', '')::timestamptz, now())
                ))) < 15 then
                  v_is_dup := true;
                end if;
              exception when others then
                null;
              end;
            end if;
          end loop;

          if not v_is_dup then
            v_reports := jsonb_build_array(v_item) || v_reports;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- Explicit single report addition delta (p_add_report)
  if p_add_report is not null and jsonb_typeof(p_add_report) = 'object' then
    if coalesce(trim(p_add_report->>'id'), '') = ''
       or coalesce(trim(p_add_report->>'type'), '') = ''
       or coalesce(trim(p_add_report->>'details'), '') = '' then
      raise exception 'REPORT_INVALID: report id, type, and details are required'
        using errcode = 'P0001';
    end if;

    v_is_dup := false;
    for v_existing_item in select e.val from jsonb_array_elements(v_reports) as e(val) loop
      if coalesce(v_existing_item->>'id', '') = coalesce(p_add_report->>'id', '') then
        v_is_dup := true; -- Idempotent retry of the exact same report ID
      elsif coalesce(v_existing_item->>'status', 'open') in ('open', 'under_review')
            and coalesce(v_existing_item->>'type', '') = coalesce(p_add_report->>'type', '')
            and trim(coalesce(v_existing_item->>'details', '')) = trim(coalesce(p_add_report->>'details', '')) then
        begin
          if abs(extract(epoch from (
            coalesce(nullif(p_add_report->>'createdAt', '')::timestamptz, now()) -
            coalesce(nullif(v_existing_item->>'createdAt', '')::timestamptz, now())
          ))) < 15 then
            v_is_dup := true;
          end if;
        exception when others then
          null;
        end;
      end if;
    end loop;

    if not v_is_dup then
      v_reports := jsonb_build_array(
        jsonb_build_object(
          'id', trim(p_add_report->>'id'),
          'problemId', coalesce(p_add_report->>'problemId', ''),
          'type', trim(p_add_report->>'type'),
          'details', trim(p_add_report->>'details'),
          'createdAt', coalesce(nullif(p_add_report->>'createdAt', ''), v_now_iso),
          'status', coalesce(nullif(p_add_report->>'status', ''), 'open')
        ) || (
          case
            when nullif(trim(p_add_report->>'attemptId'), '') is not null
            then jsonb_build_object('attemptId', trim(p_add_report->>'attemptId'))
            else '{}'::jsonb
          end
        )
      ) || v_reports;
    end if;
  end if;

  -- Explicit single report dismissal delta (p_dismiss_report)
  if p_dismiss_report is not null and jsonb_typeof(p_dismiss_report) = 'object' then
    v_dismiss_id := coalesce(trim(p_dismiss_report->>'reportId'), '');
    v_dismiss_note := coalesce(trim(p_dismiss_report->>'resolutionNote'), '');
    v_dismiss_at := coalesce(nullif(trim(p_dismiss_report->>'resolvedAt'), ''), v_now_iso);

    if v_dismiss_id = '' or v_dismiss_note = '' then
      raise exception 'DISMISS_REASON_REQUIRED: reportId and resolutionNote are required'
        using errcode = 'P0001';
    end if;

    v_found := false;
    v_next_reports := '[]'::jsonb;
    for v_existing_item in select e.val from jsonb_array_elements(v_reports) as e(val) loop
      if coalesce(v_existing_item->>'id', '') = v_dismiss_id then
        v_found := true;
        v_next_reports := v_next_reports || jsonb_build_array(
          v_existing_item || jsonb_build_object(
            'status', 'dismissed',
            'resolutionNote', v_dismiss_note,
            'resolvedAt', coalesce(nullif(v_existing_item->>'resolvedAt', ''), v_dismiss_at)
          )
        );
      else
        v_next_reports := v_next_reports || jsonb_build_array(v_existing_item);
      end if;
    end loop;

    if not v_found then
      raise exception 'REPORT_NOT_FOUND: report % does not exist', v_dismiss_id
        using errcode = 'P0002';
    end if;
    v_reports := v_next_reports;
  end if;

  -- Transition open reports to under_review when quality_status moves to under_review
  if p_new_quality_status = 'under_review' then
    v_next_reports := '[]'::jsonb;
    for v_existing_item in select e.val from jsonb_array_elements(v_reports) as e(val) loop
      if coalesce(v_existing_item->>'status', 'open') = 'open' then
        v_next_reports := v_next_reports || jsonb_build_array(
          jsonb_set(v_existing_item, '{status}', '"under_review"'::jsonb)
        );
      else
        v_next_reports := v_next_reports || jsonb_build_array(v_existing_item);
      end if;
    end loop;
    v_reports := v_next_reports;
  end if;

  -- Resolve open/under_review reports on reapproval or explicit resolveOpenReports
  if coalesce(p_resolve_open, false) or p_new_quality_status = 'reapproved' then
    v_resolve_note := coalesce(
      nullif(trim(p_resolution_note), ''),
      '문제 검토 및 수정/보완 완료 후 사용자 재승인'
    );
    v_resolve_at := v_now_iso;
    v_next_reports := '[]'::jsonb;
    for v_existing_item in select e.val from jsonb_array_elements(v_reports) as e(val) loop
      if coalesce(v_existing_item->>'status', 'open') in ('open', 'under_review') then
        v_next_reports := v_next_reports || jsonb_build_array(
          v_existing_item || jsonb_build_object(
            'status', 'resolved',
            'resolutionNote', v_resolve_note,
            'resolvedAt', v_resolve_at
          )
        );
      else
        v_next_reports := v_next_reports || jsonb_build_array(v_existing_item);
      end if;
    end loop;
    v_reports := v_next_reports;
  end if;

  return v_reports;
end;
$$;

-- 2. BEFORE UPDATE trigger on public.problems to enforce body & version integrity
create or replace function public.enforce_problems_update_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_payload jsonb;
  v_new_payload jsonb;
  v_merged_reports jsonb;
  v_safe_payload jsonb;
begin
  if new.version < old.version then
    raise exception 'VERSION_CONFLICT: cannot downgrade problem version from % to %', old.version, new.version
      using errcode = 'P0001';
  end if;

  v_old_payload := coalesce(old.payload, '{}'::jsonb);
  v_new_payload := coalesce(new.payload, '{}'::jsonb);

  if new.version = old.version then
    -- An update that does not increment `version` MUST NOT replace problem body,
    -- modelAnswer, rubric, hints, conceptIds, mathFormula, codeSnippet, timeStandardMinutes,
    -- type, title, or version. Only quality/review/source-verification fields may change.
    new.title := old.title;
    new.type := old.type;
    new.subject_id := old.subject_id;
    new.draft_id := old.draft_id;
    new.is_transfer := old.is_transfer;
    new.source_problem_id := old.source_problem_id;
    new.logic_session_id := old.logic_session_id;

    v_merged_reports := public.merge_problem_reports(
      v_old_payload->'reports',
      v_new_payload->'reports',
      null,
      null,
      new.quality_status = 'reapproved',
      v_new_payload->>'reviewNotes',
      v_new_payload->>'lastReviewedAt',
      new.quality_status
    );

    v_safe_payload := v_old_payload
      || jsonb_build_object(
        'version', old.version,
        'qualityStatus', new.quality_status,
        'isOutdated', new.is_outdated,
        'needsSourceReview', new.needs_source_review,
        'reports', v_merged_reports
      );

    if v_new_payload ? 'lastReviewedAt' and v_new_payload->'lastReviewedAt' is not null then
      v_safe_payload := jsonb_set(v_safe_payload, '{lastReviewedAt}', v_new_payload->'lastReviewedAt');
    end if;
    if v_new_payload ? 'reviewNotes' and v_new_payload->'reviewNotes' is not null then
      v_safe_payload := jsonb_set(v_safe_payload, '{reviewNotes}', v_new_payload->'reviewNotes');
    end if;
    if v_new_payload ? 'sourceMaterials' and v_new_payload->'sourceMaterials' is not null then
      v_safe_payload := jsonb_set(v_safe_payload, '{sourceMaterials}', v_new_payload->'sourceMaterials');
    end if;
    if v_new_payload ? 'sourceContentVersion' and v_new_payload->'sourceContentVersion' is not null then
      v_safe_payload := jsonb_set(v_safe_payload, '{sourceContentVersion}', v_new_payload->'sourceContentVersion');
    end if;
    if v_new_payload ? 'sourceVerificationStatus' and v_new_payload->'sourceVerificationStatus' is not null then
      v_safe_payload := jsonb_set(v_safe_payload, '{sourceVerificationStatus}', v_new_payload->'sourceVerificationStatus');
    end if;
    if v_new_payload ? 'sourcePage' and v_new_payload->'sourcePage' is not null then
      v_safe_payload := jsonb_set(v_safe_payload, '{sourcePage}', v_new_payload->'sourcePage');
    end if;

    new.payload := v_safe_payload;
  else
    -- Version increment (new.version > old.version): preserve any concurrent server reports
    -- and strictly align payload.version to new.version.
    v_merged_reports := public.merge_problem_reports(
      v_old_payload->'reports',
      v_new_payload->'reports',
      null,
      null,
      new.quality_status = 'reapproved',
      v_new_payload->>'reviewNotes',
      v_new_payload->>'lastReviewedAt',
      new.quality_status
    );
    new.payload := jsonb_set(
      jsonb_set(v_new_payload, '{version}', to_jsonb(new.version)),
      '{reports}',
      v_merged_reports
    );
  end if;

  return new;
end;
$$;

drop trigger if exists problems_enforce_update_integrity on public.problems;
create trigger problems_enforce_update_integrity
  before update on public.problems
  for each row execute function public.enforce_problems_update_integrity();

-- 3. Transactional RPC: public.update_problem_quality
create or replace function public.update_problem_quality(
  p_problem_id text,
  p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  pr public.problems%rowtype;
  v_uid uuid;
  v_patch jsonb;
  v_legacy_payload jsonb;
  v_merged_reports jsonb;
  v_has_open_reports boolean;
  v_next_status text;
  v_next_outdated boolean;
  v_next_needs_review boolean;
  v_next_payload jsonb;
  v_review_notes text;
  v_last_reviewed_at text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: update_problem_quality requires an authenticated user'
      using errcode = '42501';
  end if;

  select * into pr from public.problems
    where id = p_problem_id and user_id = v_uid
    for update;
  if not found then
    raise exception 'PROBLEM_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_patch := coalesce(p_patch, '{}'::jsonb);
  v_legacy_payload := case
    when jsonb_typeof(v_patch->'payload') = 'object' then v_patch->'payload'
    else '{}'::jsonb
  end;

  -- Optional precondition checks (version or updated_at)
  if v_patch ? 'expectedVersion' and jsonb_typeof(v_patch->'expectedVersion') = 'number' then
    if pr.version <> (v_patch->>'expectedVersion')::integer then
      raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
    end if;
  end if;
  if v_patch ? 'expectedUpdatedAt' and nullif(trim(v_patch->>'expectedUpdatedAt'), '') is not null then
    if pr.updated_at <> (v_patch->>'expectedUpdatedAt')::timestamptz then
      raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
    end if;
  end if;

  v_review_notes := coalesce(
    v_patch->>'reviewNotes',
    v_legacy_payload->>'reviewNotes',
    pr.payload->>'reviewNotes'
  );
  v_last_reviewed_at := coalesce(
    v_patch->>'lastReviewedAt',
    v_legacy_payload->>'lastReviewedAt',
    pr.payload->>'lastReviewedAt'
  );

  v_merged_reports := public.merge_problem_reports(
    pr.payload->'reports',
    coalesce(v_patch->'reports', v_legacy_payload->'reports'),
    v_patch->'addReport',
    v_patch->'dismissReport',
    coalesce((v_patch->>'resolveOpenReports')::boolean, false)
      or coalesce(v_patch->>'qualityStatus', '') = 'reapproved',
    coalesce(v_patch->>'resolutionNote', v_review_notes),
    v_last_reviewed_at,
    v_patch->>'qualityStatus'
  );

  select exists (
    select 1
    from jsonb_array_elements(v_merged_reports) as r(item)
    where coalesce(r.item->>'status', 'open') in ('open', 'under_review')
  ) into v_has_open_reports;

  if jsonb_typeof(v_patch->'addReport') = 'object' then
    v_next_status := case
      when pr.quality_status = 'under_review' then 'under_review'
      else 'reported'
    end;
  elsif jsonb_typeof(v_patch->'dismissReport') = 'object' then
    if v_has_open_reports then
      v_next_status := case
        when pr.quality_status in ('reported', 'under_review') then pr.quality_status
        else 'reported'
      end;
    else
      v_next_status := case
        when pr.version > 1 then 'reapproved'
        else 'normal'
      end;
    end if;
  elsif nullif(trim(v_patch->>'qualityStatus'), '') is not null then
    v_next_status := trim(v_patch->>'qualityStatus');
  elsif nullif(trim(v_legacy_payload->>'qualityStatus'), '') is not null then
    v_next_status := trim(v_legacy_payload->>'qualityStatus');
  else
    v_next_status := pr.quality_status;
  end if;

  if v_next_status not in ('normal', 'reported', 'under_review', 'review_after_edit', 'reapproved', 'suspended') then
    raise exception 'INVALID_QUALITY_STATUS: %', v_next_status using errcode = 'P0001';
  end if;

  v_next_outdated := coalesce(
    (v_patch->>'isOutdated')::boolean,
    (v_legacy_payload->>'isOutdated')::boolean,
    pr.is_outdated
  );
  v_next_needs_review := coalesce(
    (v_patch->>'needsSourceReview')::boolean,
    (v_legacy_payload->>'needsSourceReview')::boolean,
    pr.needs_source_review
  );

  -- Build updated payload from authoritative server payload (pr.payload),
  -- preserving all problem body/answer/rubric/version fields intact.
  v_next_payload := coalesce(pr.payload, '{}'::jsonb)
    || jsonb_build_object(
      'version', pr.version,
      'qualityStatus', v_next_status,
      'isOutdated', v_next_outdated,
      'needsSourceReview', v_next_needs_review,
      'reports', v_merged_reports
    );

  if v_last_reviewed_at is not null then
    v_next_payload := jsonb_set(v_next_payload, '{lastReviewedAt}', to_jsonb(v_last_reviewed_at));
  end if;
  if v_review_notes is not null then
    v_next_payload := jsonb_set(v_next_payload, '{reviewNotes}', to_jsonb(v_review_notes));
  end if;
  if coalesce(v_patch->'sourceMaterials', v_legacy_payload->'sourceMaterials') is not null then
    v_next_payload := jsonb_set(
      v_next_payload,
      '{sourceMaterials}',
      coalesce(v_patch->'sourceMaterials', v_legacy_payload->'sourceMaterials')
    );
  end if;
  if coalesce(v_patch->>'sourceContentVersion', v_legacy_payload->>'sourceContentVersion') is not null then
    v_next_payload := jsonb_set(
      v_next_payload,
      '{sourceContentVersion}',
      to_jsonb(coalesce(v_patch->>'sourceContentVersion', v_legacy_payload->>'sourceContentVersion'))
    );
  end if;
  if coalesce(v_patch->>'sourceVerificationStatus', v_legacy_payload->>'sourceVerificationStatus') is not null then
    v_next_payload := jsonb_set(
      v_next_payload,
      '{sourceVerificationStatus}',
      to_jsonb(coalesce(v_patch->>'sourceVerificationStatus', v_legacy_payload->>'sourceVerificationStatus'))
    );
  end if;
  if coalesce(v_patch->>'sourcePage', v_legacy_payload->>'sourcePage') is not null then
    v_next_payload := jsonb_set(
      v_next_payload,
      '{sourcePage}',
      to_jsonb(coalesce(v_patch->>'sourcePage', v_legacy_payload->>'sourcePage'))
    );
  end if;

  update public.problems set
    quality_status = v_next_status,
    is_outdated = v_next_outdated,
    needs_source_review = v_next_needs_review,
    payload = v_next_payload,
    updated_at = now()
  where id = p_problem_id and user_id = v_uid
  returning * into pr;

  return to_jsonb(pr);
end;
$$;

revoke all on function public.update_problem_quality(text, jsonb) from public, anon;
grant execute on function public.update_problem_quality(text, jsonb) to authenticated, service_role;

-- 4. Update public.revise_problem to preserve concurrent reports on the server row
--    and keep problem_versions snapshots strictly aligned.
create or replace function public.revise_problem(
  p_problem_id text,
  p_expected_version integer,
  p_problem jsonb
) returns integer
language plpgsql
security invoker
set search_path = public, auth
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
  v_merged_reports jsonb;
  v_has_open_reports boolean;
  v_effective_quality_status text;
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

  -- Merge concurrent reports from server row with incoming payload reports
  v_merged_reports := public.merge_problem_reports(
    pr.payload->'reports',
    p_problem->'reports',
    null,
    null,
    coalesce(p_problem->>'qualityStatus', '') = 'reapproved',
    p_problem->>'reviewNotes',
    p_problem->>'lastReviewedAt',
    p_problem->>'qualityStatus'
  );

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
    and coalesce(nullif(trim(p_problem->>'timeStandardMinutes'), '')::numeric, 0) = coalesce(nullif(trim(pr.payload->>'timeStandardMinutes'), '')::numeric, 0)
    and coalesce(p_problem->>'type', '') = coalesce(pr.payload->>'type', pr.type, '')
    and coalesce(p_problem->>'designIntent', '') = coalesce(pr.payload->>'designIntent', '')
    and coalesce(p_problem->>'originalCondition', '') = coalesce(pr.payload->>'originalCondition', '')
    and coalesce(p_problem->>'newCondition', '') = coalesce(pr.payload->>'newCondition', '')
    and coalesce(p_problem->>'transferChanges', '') = coalesce(pr.payload->>'transferChanges', '');

  if v_same then
    v_effective_quality_status := coalesce(p_problem->>'qualityStatus', pr.quality_status);
    v_payload := jsonb_set(
      jsonb_set(
        jsonb_set(p_problem, '{version}', to_jsonb(pr.version)),
        '{reports}',
        v_merged_reports
      ),
      '{qualityStatus}',
      to_jsonb(v_effective_quality_status)
    );
    update public.problems set
      payload = v_payload,
      is_outdated = coalesce((p_problem->>'isOutdated')::boolean, is_outdated),
      needs_source_review = coalesce((p_problem->>'needsSourceReview')::boolean, needs_source_review),
      quality_status = v_effective_quality_status,
      updated_at = now()
    where id = p_problem_id and user_id = auth.uid();

    insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
    values (auth.uid(), p_problem_id, pr.subject_id, pr.version, v_payload)
    on conflict (problem_id, version, user_id) do nothing;

    return pr.version;
  end if;

  v_new_version := pr.version + 1;

  -- Ensure prior version snapshot exists in problem_versions without mutating existing records
  v_prior_payload := jsonb_set(pr.payload, '{version}', to_jsonb(pr.version));
  insert into public.problem_versions (user_id, problem_id, subject_id, version, snapshot)
  values (auth.uid(), p_problem_id, pr.subject_id, pr.version, v_prior_payload)
  on conflict (problem_id, version, user_id) do nothing;

  v_effective_quality_status := coalesce(p_problem->>'qualityStatus', 'normal');
  v_payload := jsonb_set(
    jsonb_set(
      jsonb_set(p_problem, '{version}', to_jsonb(v_new_version)),
      '{reports}',
      v_merged_reports
    ),
    '{qualityStatus}',
    to_jsonb(v_effective_quality_status)
  );

  update public.problems set
    version = v_new_version,
    payload = v_payload,
    title = p_problem->>'title',
    type = coalesce(p_problem->>'type', type),
    is_outdated = coalesce((p_problem->>'isOutdated')::boolean, false),
    needs_source_review = coalesce((p_problem->>'needsSourceReview')::boolean, false),
    quality_status = v_effective_quality_status,
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

revoke all on function public.revise_problem(text, integer, jsonb) from public, anon;
grant execute on function public.revise_problem(text, integer, jsonb) to authenticated, service_role;

-- 5. Transactional RPC returning both the confirmed version and its immutable snapshot
create or replace function public.revise_problem_with_snapshot(
  p_problem_id text,
  p_expected_version integer,
  p_problem jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  v_confirmed_version integer;
  v_snapshot jsonb;
  v_row public.problems%rowtype;
begin
  v_confirmed_version := public.revise_problem(p_problem_id, p_expected_version, p_problem);

  select snapshot into v_snapshot
    from public.problem_versions
    where problem_id = p_problem_id
      and user_id = auth.uid()
      and version = v_confirmed_version;

  select * into v_row
    from public.problems
    where id = p_problem_id
      and user_id = auth.uid();

  return jsonb_build_object(
    'confirmedVersion', v_confirmed_version,
    'confirmedSnapshot', coalesce(v_snapshot, v_row.payload),
    'problemRow', to_jsonb(v_row)
  );
end;
$$;

revoke all on function public.revise_problem_with_snapshot(text, integer, jsonb) from public, anon;
grant execute on function public.revise_problem_with_snapshot(text, integer, jsonb) to authenticated, service_role;

revoke all on table public.problems from anon;
revoke all on table public.problem_versions from anon;
revoke all on table public.problem_concepts from anon;
grant select, insert, update, delete on table public.problems to authenticated, service_role;
grant select, insert, update, delete on table public.problem_versions to authenticated, service_role;
grant select, insert, update, delete on table public.problem_concepts to authenticated, service_role;
grant select on table public.subjects, public.concepts, public.materials to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
