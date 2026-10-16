-- Migration 20260101000020: Concurrency-Safe Analysis Job Init and Subject Ownership Verification
-- 1. Enforces subject ownership verification in public.subjects for p_user_id.
-- 2. Enforces material ownership and subject linkage when material exists on server.
-- 3. Solves primary key race conditions on concurrent initializations using INSERT ... ON CONFLICT (id) DO NOTHING followed by strict identity verification.
-- 4. Rejects conflicting job identity on existing job IDs (JOB_IDENTITY_MISMATCH).
-- 5. Guarantees atomic creation and rollbacks without re-initializing existing drafts, lease, attempts, or completed status.
-- 6. Strictly restricts execution to service_role.

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
  v_subject_user_id uuid;
  v_mat_user_id uuid;
  v_mat_subject_id text;
  v_existing_job public.analysis_jobs%rowtype;
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

  -- 2. Verify Subject Ownership
  -- In server-synced workflows, subject_id MUST exist in public.subjects and belong to p_user_id.
  select user_id into v_subject_user_id
  from public.subjects
  where id = p_subject_id and user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', '과목 또는 자료를 찾을 수 없거나 접근 권한이 없습니다.',
      'error_code', 'NOT_FOUND_OR_FORBIDDEN'
    );
  end if;

  -- 3. Verify Material Ownership & Subject Linkage (if material exists on server)
  select user_id, subject_id into v_mat_user_id, v_mat_subject_id
  from public.materials
  where id = p_material_id;

  if found then
    if v_mat_user_id is not null and v_mat_user_id <> p_user_id then
      return jsonb_build_object(
        'success', false,
        'error', '과목 또는 자료를 찾을 수 없거나 접근 권한이 없습니다.',
        'error_code', 'NOT_FOUND_OR_FORBIDDEN'
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
  -- If material row does NOT exist in public.materials, it is accepted as a local-only material,
  -- but subject ownership has already been authoritatively validated above.

  -- 4. Concurrency-Safe Job Insert
  -- Using ON CONFLICT (id) DO NOTHING eliminates primary key race conditions between concurrent requests.
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
  )
  on conflict (id) do nothing;

  -- 5. Fetch authoritative job row
  select * into v_existing_job
  from public.analysis_jobs
  where id = p_job_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error', '작업 초기화에 실패했습니다.',
      'error_code', 'JOB_INIT_FAILED'
    );
  end if;

  -- Verify job ownership
  if v_existing_job.user_id <> p_user_id then
    return jsonb_build_object(
      'success', false,
      'error', '과목 또는 자료를 찾을 수 없거나 접근 권한이 없습니다.',
      'error_code', 'NOT_FOUND_OR_FORBIDDEN'
    );
  end if;

  -- 6. Strict Job Identity Consistency Verification
  -- If a concurrent or retry request arrives with the same job_id but different parameters,
  -- strictly reject with conflict instead of blindly assuming success.
  if v_existing_job.subject_id <> p_subject_id
     or v_existing_job.material_id <> p_material_id
     or v_existing_job.markdown_hash <> p_markdown_hash
     or v_existing_job.domain <> p_domain
     or v_existing_job.model_id <> p_model_id
     or v_existing_job.prompt_version <> coalesce(p_prompt_version, 'v2')
     or v_existing_job.chunking_version <> coalesce(p_chunking_version, 'v1')
     or v_existing_job.total_chunks <> p_total_chunks then
    return jsonb_build_object(
      'success', false,
      'error', '동일한 작업 식별자에 다른 분석 정보가 전달되었습니다.',
      'error_code', 'JOB_IDENTITY_MISMATCH'
    );
  end if;

  -- Update timestamp without touching existing status ('completed', 'processing', 'paused')
  update public.analysis_jobs
  set updated_at = now()
  where id = p_job_id;

  -- 7. Insert Chunks with ON CONFLICT DO NOTHING
  -- Existing chunks, leases, attempt counts, and drafts are never overwritten.
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
    'total_chunks', p_total_chunks,
    'status', v_existing_job.status
  );
end;
$$;

-- Revoke all permissions from public, anon, and authenticated
revoke all on function public.init_analysis_job_and_chunks(uuid, text, text, text, text, text, text, text, text, integer, jsonb) from public, anon, authenticated;

-- Grant execution strictly to service_role
grant execute on function public.init_analysis_job_and_chunks(uuid, text, text, text, text, text, text, text, text, integer, jsonb) to service_role;
