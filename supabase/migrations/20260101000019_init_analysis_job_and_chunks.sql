-- Migration 20260101000019: Atomic Analysis Job and Chunks Initialization for Server Role
-- 1. Provides a single atomic transaction for creating an analysis job and its initial chunks.
-- 2. Restricts execution strictly to service_role (the verified server route handler).
-- 3. Verifies material ownership when the material exists on the server, while preserving support for local-only materials.
-- 4. Uses ON CONFLICT DO NOTHING for chunks to ensure retries or concurrent requests NEVER reset existing completed chunks, active leases, or drafts.

create or replace function public.init_analysis_job_and_chunks(
  p_user_id uuid,
  p_job_id text,
  p_subject_id text,
  p_material_id text,
  p_markdown_hash text,
  p_domain text,
  p_model_id text,
  p_prompt_version text,
  p_chunking_version text,
  p_total_chunks integer,
  p_chunks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_job public.analysis_jobs%rowtype;
  v_mat_user_id uuid;
  v_mat_subject_id text;
  v_chunk jsonb;
  v_chunk_idx integer;
  v_source_ctx text;
begin
  -- 1. Verify User ID
  if p_user_id is null then
    return jsonb_build_object(
      'success', false,
      'error', '사용자 식별자가 누락되었습니다.',
      'error_code', 'UNAUTHORIZED'
    );
  end if;

  -- 2. Ownership & Relation Verification
  -- Verify if material exists in server materials table
  select user_id, subject_id into v_mat_user_id, v_mat_subject_id
  from public.materials
  where id = p_material_id;

  if found then
    if v_mat_user_id is not null and v_mat_user_id <> p_user_id then
      return jsonb_build_object(
        'success', false,
        'error', '자료에 대한 접근 권한이 없습니다.',
        'error_code', 'FORBIDDEN'
      );
    end if;
    if v_mat_subject_id is not null and v_mat_subject_id <> p_subject_id then
      return jsonb_build_object(
        'success', false,
        'error', '과목 식별자가 자료의 과목과 일치하지 않습니다.',
        'error_code', 'SUBJECT_MISMATCH'
      );
    end if;
  end if;
  -- If material does not exist on server, we do not fail (preserving local-only material support)

  -- 3. Check if job already exists
  select * into v_existing_job
  from public.analysis_jobs
  where id = p_job_id;

  if found then
    -- Verify ownership of existing job
    if v_existing_job.user_id <> p_user_id then
      return jsonb_build_object(
        'success', false,
        'error', '기존 작업에 대한 접근 권한이 없습니다.',
        'error_code', 'FORBIDDEN'
      );
    end if;

    -- Verify job identity consistency
    if v_existing_job.material_id <> p_material_id or v_existing_job.markdown_hash <> p_markdown_hash then
      return jsonb_build_object(
        'success', false,
        'error', '작업 식별자와 본문 해시가 일치하지 않습니다.',
        'error_code', 'JOB_IDENTITY_MISMATCH'
      );
    end if;

    -- Job exists: update updated_at if not terminal
    update public.analysis_jobs
    set updated_at = now()
    where id = p_job_id;
  else
    -- Insert new job record
    insert into public.analysis_jobs (
      id,
      user_id,
      subject_id,
      material_id,
      markdown_hash,
      domain,
      model_id,
      prompt_version,
      chunking_version,
      total_chunks,
      status,
      created_at,
      updated_at
    ) values (
      p_job_id,
      p_user_id,
      p_subject_id,
      p_material_id,
      p_markdown_hash,
      p_domain,
      p_model_id,
      coalesce(p_prompt_version, 'v2'),
      coalesce(p_chunking_version, 'v1'),
      p_total_chunks,
      'pending',
      now(),
      now()
    );
  end if;

  -- 4. Insert chunks with ON CONFLICT DO NOTHING
  -- This guarantees retries, re-initialization, or concurrent workers NEVER overwrite completed chunks or active leases
  if p_chunks is not null and jsonb_typeof(p_chunks) = 'array' then
    for v_chunk in select * from jsonb_array_elements(p_chunks)
    loop
      v_chunk_idx := (v_chunk->>'chunk_index')::integer;
      v_source_ctx := coalesce(v_chunk->>'source_context', '청크 ' || v_chunk_idx);

      if v_chunk_idx is not null and v_chunk_idx > 0 then
        insert into public.analysis_job_chunks (
          job_id,
          chunk_index,
          source_context,
          status,
          drafts,
          attempt_count,
          created_at,
          updated_at
        ) values (
          p_job_id,
          v_chunk_idx,
          v_source_ctx,
          'pending',
          '[]'::jsonb,
          0,
          now(),
          now()
        )
        on conflict (job_id, chunk_index) do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'success', true,
    'job_id', p_job_id,
    'total_chunks', p_total_chunks
  );
end;
$$;

-- Revoke all permissions from public, anon, and authenticated
revoke all on function public.init_analysis_job_and_chunks(uuid, text, text, text, text, text, text, text, text, integer, jsonb) from public, anon, authenticated;

-- Grant execution strictly to service_role
grant execute on function public.init_analysis_job_and_chunks(uuid, text, text, text, text, text, text, text, text, integer, jsonb) to service_role;
