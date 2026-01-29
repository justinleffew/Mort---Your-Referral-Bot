create extension if not exists "pgcrypto";

create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  source_contact_id uuid references public.contacts(id) on delete set null,
  referred_name text not null,
  stage text default 'intro',
  status text default 'active',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.referral_events enable row level security;

alter table public.touches enable row level security;

drop policy if exists "touches_select_own" on public.touches;
drop policy if exists "touches_insert_own" on public.touches;
drop policy if exists "touches_update_own" on public.touches;
drop policy if exists "touches_delete_own" on public.touches;

drop policy if exists "referral_events_select_own" on public.referral_events;
drop policy if exists "referral_events_insert_own" on public.referral_events;
drop policy if exists "referral_events_update_own" on public.referral_events;
drop policy if exists "referral_events_delete_own" on public.referral_events;

create policy "touches_select_own" on public.touches
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "touches_insert_own" on public.touches
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "touches_update_own" on public.touches
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "touches_delete_own" on public.touches
  for delete
  to authenticated
  using (user_id = auth.uid()::text);

create policy "referral_events_select_own" on public.referral_events
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "referral_events_insert_own" on public.referral_events
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "referral_events_update_own" on public.referral_events
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "referral_events_delete_own" on public.referral_events
  for delete
  to authenticated
  using (user_id = auth.uid()::text);
