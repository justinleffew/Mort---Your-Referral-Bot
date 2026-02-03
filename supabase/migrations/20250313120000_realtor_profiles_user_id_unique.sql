alter table public.realtor_profiles
  add column if not exists user_id text;

create unique index if not exists realtor_profiles_user_id_key
  on public.realtor_profiles (user_id);
