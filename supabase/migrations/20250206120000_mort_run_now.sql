create extension if not exists "pgcrypto";

alter table public.contacts
  alter column id set default gen_random_uuid();

alter table public.contact_notes
  alter column id set default gen_random_uuid();

alter table public.touches
  alter column id set default gen_random_uuid();

alter table public.contacts
  add column if not exists cadence_days int not null default 90,
  add column if not exists cadence_mode text not null default 'AUTO',
  add column if not exists safe_mode boolean not null default false,
  add column if not exists do_not_contact boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_cadence_mode_check') then
    alter table public.contacts
      add constraint contacts_cadence_mode_check
      check (cadence_mode in ('AUTO','MANUAL'));
  end if;
end $$;

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  state text,
  country text default 'US',
  timezone text default 'America/New_York',
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'areas_type_check') then
    alter table public.areas
      add constraint areas_type_check
      check (type in ('METRO','CITY','SUBURB','REGION'));
  end if;
end $$;

create unique index if not exists areas_unique_name_type_state_idx
  on public.areas (lower(name), type, coalesce(state, ''));

create table if not exists public.area_aliases (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  alias text not null
);

create unique index if not exists area_aliases_unique
  on public.area_aliases (lower(alias));

create table if not exists public.area_includes (
  parent_area_id uuid not null references public.areas(id) on delete cascade,
  child_area_id uuid not null references public.areas(id) on delete cascade,
  primary key (parent_area_id, child_area_id)
);

alter table public.contacts
  add column if not exists home_area_id uuid references public.areas(id);

create index if not exists contacts_user_id_idx on public.contacts(user_id);
create index if not exists contacts_home_area_idx on public.contacts(home_area_id);
create index if not exists touches_contact_created_idx on public.touches(contact_id, created_at desc);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  area_id uuid references public.areas(id) on delete set null,

  run_context text not null default 'WEEKLY',
  score int not null default 0,
  reasons jsonb not null default '[]'::jsonb,

  suggested_messages jsonb not null default '[]'::jsonb,
  chosen_message text,
  status text not null default 'new',

  warning_flags text[] not null default '{}'::text[],
  last_touch_at timestamptz,
  touches_last_365 int not null default 0,
  cadence_violation boolean not null default false,
  year_cap_exceeded boolean not null default false,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'opportunities_run_context_check') then
    alter table public.opportunities
      add constraint opportunities_run_context_check
      check (run_context in ('WEEKLY','RUN_NOW'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'opportunities_status_check') then
    alter table public.opportunities
      add constraint opportunities_status_check
      check (status in ('new','dismissed','sent','snoozed'));
  end if;
end $$;

create index if not exists opportunities_user_created_idx
  on public.opportunities (user_id, created_at desc);

create index if not exists opportunities_contact_status_idx
  on public.opportunities (contact_id, status, created_at desc);

create or replace function public.run_now_candidates(p_user_id text)
returns table (
  id uuid,
  full_name text,
  phone text,
  email text,
  cadence_days int,
  cadence_mode text,
  safe_mode boolean,
  home_area_id uuid,
  notes_count int,
  last_note_at timestamptz,
  last_touch_at timestamptz,
  touches_last_365 int,
  days_since_last_touch int
)
language sql
stable
as $$
  with last_touch as (
    select
      c.id as contact_id,
      max(t.created_at) as last_touch_at,
      count(*) filter (where t.created_at >= now() - interval '365 days') as touches_last_365
    from public.contacts c
    left join public.touches t
      on t.contact_id = c.id
     and t.user_id = c.user_id
    where c.user_id = p_user_id
    group by c.id
  ),
  notes_agg as (
    select
      cn.contact_id,
      count(*) as notes_count,
      max(cn.created_at) as last_note_at
    from public.contact_notes cn
    where cn.user_id = p_user_id
    group by cn.contact_id
  )
  select
    c.id,
    c.full_name,
    c.phone,
    c.email,
    c.cadence_days,
    c.cadence_mode,
    c.safe_mode,
    c.home_area_id,
    coalesce(na.notes_count, 0) as notes_count,
    na.last_note_at,
    lt.last_touch_at,
    coalesce(lt.touches_last_365, 0) as touches_last_365,
    case when lt.last_touch_at is null then 9999 else extract(day from (now() - lt.last_touch_at)) end as days_since_last_touch
  from public.contacts c
  left join last_touch lt on lt.contact_id = c.id
  left join notes_agg na on na.contact_id = c.id
  where c.user_id = p_user_id
    and coalesce(c.archived,false) = false
    and coalesce(c.do_not_contact,false) = false;
$$;

insert into public.areas (name, type, state)
values ('Columbus Metro', 'METRO', 'OH')
on conflict do nothing;

insert into public.areas (name, type, state)
values ('Columbus', 'CITY', 'OH')
on conflict do nothing;

with metro as (
  select id from public.areas where name='Columbus Metro' and type='METRO' limit 1
)
insert into public.areas (name, type, state)
select unnest(array[
  'New Albany','Dublin','Westerville','Hilliard','Gahanna','Upper Arlington',
  'Worthington','Pickerington','Reynoldsburg','Powell'
]), 'SUBURB', 'OH'
on conflict do nothing;

insert into public.area_includes (parent_area_id, child_area_id)
select
  (select id from public.areas where name='Columbus Metro' and type='METRO' limit 1),
  a.id
from public.areas a
where a.type='SUBURB' and a.state='OH'
on conflict do nothing;

update public.contacts
set home_area_id = (select id from public.areas where name='Columbus Metro' and type='METRO' limit 1)
where home_area_id is null;
