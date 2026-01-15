create extension if not exists pgcrypto;

create table if not exists contacts (
  id uuid primary key,
  user_id text not null,
  full_name text not null,
  phone text,
  email text,
  location_context text,
  sale_date date,
  last_contacted_at timestamptz,
  comfort_level text,
  archived boolean default false,
  created_at timestamptz default now(),
  radar_interests text[] default '{}',
  family_details jsonb default '{}'::jsonb,
  mortgage_inference jsonb,
  suggested_action text
);

create table if not exists contact_notes (
  id uuid primary key,
  contact_id uuid references contacts(id) on delete cascade,
  user_id text not null,
  note_text text not null,
  created_at timestamptz default now()
);

create table if not exists radar_state (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  user_id text not null,
  reached_out boolean default false,
  reached_out_at timestamptz,
  suppressed_until date,
  last_prompt_shown_at timestamptz,
  angles_used_json jsonb default '[]'::jsonb,
  last_angle text,
  last_reason text,
  last_message text,
  last_refreshed_at timestamptz default now()
);

create table if not exists touches (
  id uuid primary key,
  contact_id uuid references contacts(id) on delete cascade,
  user_id text not null,
  type text not null,
  channel text,
  body text,
  source text,
  created_at timestamptz default now()
);

create table if not exists realtor_profiles (
  user_id text primary key,
  name text not null,
  headshot text
);

create index if not exists contacts_user_id_idx on contacts (user_id);
create index if not exists contact_notes_contact_id_user_id_idx on contact_notes (contact_id, user_id);
create index if not exists touches_contact_id_user_id_idx on touches (contact_id, user_id);
create index if not exists radar_state_user_id_idx on radar_state (user_id);
alter table contacts enable row level security;
alter table contact_notes enable row level security;
alter table radar_state enable row level security;
alter table touches enable row level security;
alter table realtor_profiles enable row level security;

drop policy if exists "contacts_anon" on contacts;
drop policy if exists "contact_notes_anon" on contact_notes;
drop policy if exists "radar_state_anon" on radar_state;
drop policy if exists "touches_anon" on touches;
drop policy if exists "realtor_profiles_anon" on realtor_profiles;

create policy "contacts_select_own" on contacts
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "contacts_insert_own" on contacts
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "contacts_update_own" on contacts
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "contacts_delete_own" on contacts
  for delete
  to authenticated
  using (user_id = auth.uid()::text);

create policy "contact_notes_select_own" on contact_notes
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "contact_notes_insert_own" on contact_notes
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "contact_notes_update_own" on contact_notes
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "contact_notes_delete_own" on contact_notes
  for delete
  to authenticated
  using (user_id = auth.uid()::text);

create policy "radar_state_select_own" on radar_state
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "radar_state_insert_own" on radar_state
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "radar_state_update_own" on radar_state
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "radar_state_delete_own" on radar_state
  for delete
  to authenticated
  using (user_id = auth.uid()::text);

create policy "touches_select_own" on touches
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "touches_insert_own" on touches
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "touches_update_own" on touches
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "touches_delete_own" on touches
  for delete
  to authenticated
  using (user_id = auth.uid()::text);

create policy "realtor_profiles_select_own" on realtor_profiles
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "realtor_profiles_insert_own" on realtor_profiles
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "realtor_profiles_update_own" on realtor_profiles
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "realtor_profiles_delete_own" on realtor_profiles
  for delete
  to authenticated
  using (user_id = auth.uid()::text);
