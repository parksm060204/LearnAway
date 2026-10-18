-- ==============================================================================
-- Migration 20260101000030: AI Usage and Operating Cost Telemetry Table
-- Plan 05 - P05-05 & P05-07: Track token usage, cost, latency, and errors
--
-- Security & Privacy:
-- 1. RLS enabled: Users may only view their own usage telemetry records.
-- 2. Service role has full insert and query capability for administrative reporting.
-- 3. Anonymous/public callers have zero direct access.
-- 4. Minimal telemetry: No raw prompts or student answers stored in telemetry table.
--
-- Rollback Strategy:
-- DROP TABLE IF EXISTS public.ai_usage_telemetry;
-- ==============================================================================

create table if not exists public.ai_usage_telemetry (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  user_id text not null,
  task_type text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  is_estimated_tokens boolean not null default false,
  estimated_cost_usd numeric(10, 6) not null default 0,
  estimated_cost_krw numeric(12, 2) not null default 0,
  execution_time_ms integer not null default 0,
  status text not null,
  error_code text,
  credit_source text not null check (credit_source in ('operator_trial', 'personal_key')),
  created_at timestamptz not null default timezone('utc'::text, now())
);

-- Indexes for efficient aggregation and filtering
create index if not exists idx_ai_usage_telemetry_created_at
  on public.ai_usage_telemetry (created_at desc);

create index if not exists idx_ai_usage_telemetry_user_id
  on public.ai_usage_telemetry (user_id);

create index if not exists idx_ai_usage_telemetry_task_type
  on public.ai_usage_telemetry (task_type);

create index if not exists idx_ai_usage_telemetry_credit_source
  on public.ai_usage_telemetry (credit_source);

-- Enable Row Level Security (RLS)
alter table public.ai_usage_telemetry enable row level security;

-- Authenticated users can view their own telemetry records
create policy "Users can view own telemetry"
  on public.ai_usage_telemetry
  for select
  to authenticated
  using (user_id = auth.uid()::text);

-- Service role has full management access
create policy "Service role full access to telemetry"
  on public.ai_usage_telemetry
  for all
  to service_role
  using (true)
  with check (true);
