-- Migration 20260101000013: Persistent Analysis Jobs and Atomic Chunk Leases
-- Provides persistent state, account isolation, atomic chunk leases, and retry safety for concept analysis.

create table if not exists public.analysis_jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id text not null,
  material_id text not null,
  markdown_hash text not null,
  domain text not null check (domain in ('math_stats', 'computer_science')),
  model_id text not null,
  prompt_version text not null default 'v2',
  chunking_version text not null default 'v1',
  total_chunks integer not null check (total_chunks > 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analysis_jobs_user_mat on public.analysis_jobs(user_id, material_id);
create index if not exists idx_analysis_jobs_hash on public.analysis_jobs(user_id, markdown_hash);

alter table public.analysis_jobs enable row level security;

create policy "Users can view their own analysis jobs"
  on public.analysis_jobs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own analysis jobs"
  on public.analysis_jobs for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own analysis jobs"
  on public.analysis_jobs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own analysis jobs"
  on public.analysis_jobs for delete
  using (auth.uid() = user_id);

create table if not exists public.analysis_job_chunks (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.analysis_jobs(id) on delete cascade,
  chunk_index integer not null check (chunk_index > 0),
  source_context text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  drafts jsonb not null default '[]'::jsonb,
  attempt_count integer not null default 0,
  last_error text,
  lease_worker_id text,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_job_chunk unique (job_id, chunk_index)
);

create index if not exists idx_analysis_chunks_lookup on public.analysis_job_chunks(job_id, chunk_index);

alter table public.analysis_job_chunks enable row level security;

create policy "Users can view their own job chunks"
  on public.analysis_job_chunks for select
  using (
    exists (
      select 1 from public.analysis_jobs j
      where j.id = analysis_job_chunks.job_id and j.user_id = auth.uid()
    )
  );

create policy "Users can insert chunks for their own jobs"
  on public.analysis_job_chunks for insert
  with check (
    exists (
      select 1 from public.analysis_jobs j
      where j.id = analysis_job_chunks.job_id and j.user_id = auth.uid()
    )
  );

create policy "Users can update chunks for their own jobs"
  on public.analysis_job_chunks for update
  using (
    exists (
      select 1 from public.analysis_jobs j
      where j.id = analysis_job_chunks.job_id and j.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.analysis_jobs j
      where j.id = analysis_job_chunks.job_id and j.user_id = auth.uid()
    )
  );

create policy "Users can delete chunks for their own jobs"
  on public.analysis_job_chunks for delete
  using (
    exists (
      select 1 from public.analysis_jobs j
      where j.id = analysis_job_chunks.job_id and j.user_id = auth.uid()
    )
  );
