alter table public.opportunities enable row level security;

alter table public.contact_notes enable row level security;

drop policy if exists "opportunities_select_own" on public.opportunities;
drop policy if exists "opportunities_insert_own" on public.opportunities;
drop policy if exists "opportunities_update_own" on public.opportunities;
drop policy if exists "opportunities_delete_own" on public.opportunities;

create policy "opportunities_select_own" on public.opportunities
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "opportunities_insert_own" on public.opportunities
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "opportunities_update_own" on public.opportunities
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "opportunities_delete_own" on public.opportunities
  for delete
  to authenticated
  using (user_id = auth.uid()::text);
