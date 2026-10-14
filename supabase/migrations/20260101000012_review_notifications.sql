-- Migration 20260101000012: Review Notification Subscriptions and Delivery Ledger
-- Manages user consent, preferred KST notification time, idempotency, and delivery tracking.

create table if not exists public.review_notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'web_push')),
  target text not null,
  preferred_hour_kst int not null default 9 check (preferred_hour_kst between 0 and 23),
  is_active boolean not null default true,
  consented_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_user_notification_channel unique (user_id, channel)
);

create index if not exists idx_notification_sub_user on public.review_notification_subscriptions(user_id);
create index if not exists idx_notification_sub_active on public.review_notification_subscriptions(is_active, preferred_hour_kst);

alter table public.review_notification_subscriptions enable row level security;

create policy "Users can manage their own notification subscriptions"
  on public.review_notification_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.review_notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.review_notification_subscriptions(id) on delete set null,
  idempotency_key text not null unique,
  channel text not null,
  status text not null check (status in ('pending', 'delivered', 'failed', 'suppressed')),
  due_item_count int not null default 0,
  message text not null,
  error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_log_user on public.review_notification_logs(user_id);
create index if not exists idx_notification_log_idempotency on public.review_notification_logs(idempotency_key);

alter table public.review_notification_logs enable row level security;

create policy "Users can view their own notification delivery logs"
  on public.review_notification_logs
  for select
  using (auth.uid() = user_id);
