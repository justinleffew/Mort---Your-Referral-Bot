alter table public.contact_notes
  drop column if exists user_id;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contact_notes'
      and column_name = 'note_text'
  ) then
    alter table public.contact_notes
      rename column note_text to body;
  end if;
end $$;

create index if not exists contact_notes_contact_id_idx
  on public.contact_notes(contact_id);

drop policy if exists "contact_notes_select_own" on public.contact_notes;
drop policy if exists "contact_notes_insert_own" on public.contact_notes;
drop policy if exists "contact_notes_update_own" on public.contact_notes;
drop policy if exists "contact_notes_delete_own" on public.contact_notes;

create policy "contact_notes_select_own" on public.contact_notes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.contacts c
      where c.id = contact_notes.contact_id
        and c.user_id = auth.uid()::text
    )
  );

create policy "contact_notes_insert_own" on public.contact_notes
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.contacts c
      where c.id = contact_notes.contact_id
        and c.user_id = auth.uid()::text
    )
  );

create policy "contact_notes_update_own" on public.contact_notes
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.contacts c
      where c.id = contact_notes.contact_id
        and c.user_id = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1
      from public.contacts c
      where c.id = contact_notes.contact_id
        and c.user_id = auth.uid()::text
    )
  );

create policy "contact_notes_delete_own" on public.contact_notes
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.contacts c
      where c.id = contact_notes.contact_id
        and c.user_id = auth.uid()::text
    )
  );

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
    join public.contacts c
      on c.id = cn.contact_id
    where c.user_id = p_user_id
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
