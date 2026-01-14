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

alter table contacts enable row level security;
alter table contact_notes enable row level security;
alter table radar_state enable row level security;
alter table touches enable row level security;
alter table realtor_profiles enable row level security;

drop policy if exists "Enable read access for all users" on contacts;
drop policy if exists "Enable read access for all users" on contact_notes;
drop policy if exists "Enable read access for all users" on radar_state;
drop policy if exists "Enable read access for all users" on touches;
drop policy if exists "Enable read access for all users" on realtor_profiles;

create policy "contacts_select" on contacts
  for select using (user_id = auth.uid());

create policy "contacts_insert" on contacts
  for insert with check (user_id = auth.uid());

create policy "contacts_update" on contacts
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "contacts_delete" on contacts
  for delete using (user_id = auth.uid());

create policy "contact_notes_select" on contact_notes
  for select using (user_id = auth.uid());

create policy "contact_notes_insert" on contact_notes
  for insert with check (user_id = auth.uid());

create policy "contact_notes_update" on contact_notes
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "contact_notes_delete" on contact_notes
  for delete using (user_id = auth.uid());

create policy "radar_state_select" on radar_state
  for select using (user_id = auth.uid());

create policy "radar_state_insert" on radar_state
  for insert with check (user_id = auth.uid());

create policy "radar_state_update" on radar_state
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "radar_state_delete" on radar_state
  for delete using (user_id = auth.uid());

create policy "touches_select" on touches
  for select using (user_id = auth.uid());

create policy "touches_insert" on touches
  for insert with check (user_id = auth.uid());

create policy "touches_update" on touches
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "touches_delete" on touches
  for delete using (user_id = auth.uid());

create policy "realtor_profiles_select" on realtor_profiles
  for select using (user_id = auth.uid());

create policy "realtor_profiles_insert" on realtor_profiles
  for insert with check (user_id = auth.uid());

create policy "realtor_profiles_update" on realtor_profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "realtor_profiles_delete" on realtor_profiles
  for delete using (user_id = auth.uid());
