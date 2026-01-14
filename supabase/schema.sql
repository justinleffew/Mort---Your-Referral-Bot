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
