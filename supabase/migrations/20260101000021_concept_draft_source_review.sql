-- Migration 20260101000021: Persistent Concept Draft Source Review State
-- 1. Adds needs_source_review column to public.concept_drafts to persist source-outdated flags in server DB.
-- 2. Provides flag_concept_drafts_source_review RPC for atomic, targeted update of source review status.
-- 3. Strictly preserves user edits, approved state, content_version, and existing source citation evidence.
-- 4. Prevents stale recovery requests from overwriting drafts re-verified against newer source versions.
-- 5. Enforces caller ownership (auth.uid() = user_id) and material linkage.

alter table public.concept_drafts
  add column if not exists needs_source_review boolean not null default false;

create index if not exists idx_concept_drafts_review
  on public.concept_drafts(user_id, material_id, needs_source_review);

create or replace function public.flag_concept_drafts_source_review(
  p_draft_ids text[],
  p_material_id text,
  p_source_markdown_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_updated_count integer := 0;
  v_draft record;
  v_new_payload jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'error', '인증되지 않은 사용자입니다.',
      'error_code', 'UNAUTHORIZED'
    );
  end if;

  if p_draft_ids is null or array_length(p_draft_ids, 1) is null or array_length(p_draft_ids, 1) = 0 then
    return jsonb_build_object('success', true, 'updated_count', 0);
  end if;

  for v_draft in
    select *
    from public.concept_drafts
    where id = any(p_draft_ids)
      and user_id = v_user_id
      and material_id = p_material_id
    for update
  loop
    -- Guard: If the draft in DB was already generated or re-verified against a newer source
    -- (i.e. sourceMarkdownHash is already different from p_source_markdown_hash),
    -- do NOT roll back or force review required on the newer content!
    if coalesce(v_draft.payload->>'sourceMarkdownHash', '') = p_source_markdown_hash then
      v_new_payload := jsonb_set(
        coalesce(v_draft.payload, '{}'::jsonb),
        '{needsSourceReview}',
        'true'::jsonb
      );

      if v_new_payload ? 'sourceEvidence' and (v_new_payload->'sourceEvidence') is not null then
        v_new_payload := jsonb_set(
          v_new_payload,
          '{sourceEvidence,verified}',
          'false'::jsonb
        );
        v_new_payload := jsonb_set(
          v_new_payload,
          '{sourceEvidence,verificationNote}',
          to_jsonb('근거 자료 본문이 수정되어 재검토가 필요합니다.'::text)
        );
      end if;

      update public.concept_drafts
      set
        needs_source_review = true,
        payload = v_new_payload,
        updated_at = now()
      where id = v_draft.id and user_id = v_user_id;

      v_updated_count := v_updated_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'updated_count', v_updated_count
  );
end;
$$;
