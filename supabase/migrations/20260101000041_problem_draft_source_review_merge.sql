-- ============================================================================
-- Migration 41: Atomic conditional merge for problem_drafts source-review flags.
--
-- Fixes concurrency & edit-preservation issues in upsertProblemDrafts():
--   1. Locks the target problem_drafts row (FOR UPDATE) scoped to auth.uid().
--   2. Preserves approved/rejected decisions without overwriting.
--   3. Preserves drafts already re-verified against a different/newer source
--      (so a stale cached retry cannot revert a newer verified source).
--   4. Preserves all user-edited fields (even when content_version > 1) and
--      merges ONLY needsSourceReview=true and sourceVerificationStatus='needs_review'
--      onto the current payload JSONB.
-- ============================================================================

create or replace function public.mark_problem_draft_source_review(
  p_draft_id text,
  p_expected_source_content_version text default null,
  p_expected_source_materials jsonb default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.problem_drafts%rowtype;
  v_payload jsonb;
  v_cur_ver text;
  v_cur_mats jsonb;
  v_cur_status text;
  v_cur_needs boolean;
begin
  select * into v_row
    from public.problem_drafts
    where id = p_draft_id and user_id = auth.uid()
    for update;

  if not found then
    return jsonb_build_object('updated', false, 'reason', 'NOT_FOUND');
  end if;

  if v_row.is_approved
     or v_row.status in ('approved', 'rejected')
     or v_row.approval_state = 'approved' then
    return jsonb_build_object('updated', false, 'reason', 'ALREADY_DECIDED');
  end if;

  v_payload := coalesce(v_row.payload, '{}'::jsonb);
  v_cur_status := coalesce(v_payload->>'sourceVerificationStatus', '');
  v_cur_needs := coalesce((v_payload->>'needsSourceReview')::boolean, false);
  v_cur_ver := nullif(v_payload->>'sourceContentVersion', '');
  v_cur_mats := v_payload->'sourceMaterials';

  -- Never revert a draft that has already been re-verified against a different/newer source.
  if v_cur_status = 'verified' and not v_cur_needs then
    if (p_expected_source_content_version is not null and v_cur_ver is not null and v_cur_ver is distinct from p_expected_source_content_version)
       or (p_expected_source_materials is not null and v_cur_mats is not null and v_cur_mats is distinct from p_expected_source_materials) then
      return jsonb_build_object('updated', false, 'reason', 'REVERIFIED_NEWER_SOURCE');
    end if;
  end if;

  if v_cur_needs and v_cur_status = 'needs_review' then
    return jsonb_build_object('updated', false, 'reason', 'ALREADY_FLAGGED');
  end if;

  update public.problem_drafts
    set payload = v_payload || jsonb_build_object(
          'needsSourceReview', true,
          'sourceVerificationStatus', 'needs_review'
        ),
        updated_at = now()
    where id = p_draft_id and user_id = auth.uid();

  return jsonb_build_object('updated', true, 'reason', 'FLAGGED');
end;
$$;

revoke all on function public.mark_problem_draft_source_review(text, text, jsonb) from public, anon;
grant execute on function public.mark_problem_draft_source_review(text, text, jsonb) to authenticated, service_role;
