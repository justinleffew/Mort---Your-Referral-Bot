alter table public.realtor_profiles
  add column if not exists cadence_type text default 'quarterly',
  add column if not exists cadence_custom_days integer;

alter table public.realtor_profiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'realtor_profiles'
      and policyname = 'realtor_profiles_select_own'
  ) then
    create policy "realtor_profiles_select_own" on public.realtor_profiles
      for select
      to authenticated
      using (user_id = auth.uid()::text);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'realtor_profiles'
      and policyname = 'realtor_profiles_insert_own'
  ) then
    create policy "realtor_profiles_insert_own" on public.realtor_profiles
      for insert
      to authenticated
      with check (user_id = auth.uid()::text);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'realtor_profiles'
      and policyname = 'realtor_profiles_update_own'
  ) then
    create policy "realtor_profiles_update_own" on public.realtor_profiles
      for update
      to authenticated
      using (user_id = auth.uid()::text)
      with check (user_id = auth.uid()::text);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'realtor_profiles'
      and policyname = 'realtor_profiles_delete_own'
  ) then
    create policy "realtor_profiles_delete_own" on public.realtor_profiles
      for delete
      to authenticated
      using (user_id = auth.uid()::text);
  end if;
end $$;
