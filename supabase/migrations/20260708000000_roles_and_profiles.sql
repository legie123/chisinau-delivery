-- Roles and profiles: the single source of truth for who a user is.
-- All RLS policies in later migrations key off has_role()/has_any_role().

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role text not null check (role in ('customer', 'courier', 'restaurant_partner', 'platform_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Shared by every table with an updated_at column across later migrations.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.has_role(required text)
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = required
  );
$$;

create or replace function public.has_any_role(roles text[])
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = any(roles)
  );
$$;

-- Every authenticated user can read their own profile; platform_admin reads all.
create policy "profiles_read_own" on public.profiles
  for select using (id = auth.uid() or has_role('platform_admin'));

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Row creation happens server-side (signup trigger below, or admin invite flow),
-- never directly from the client.
create function public.handle_new_customer_signup()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Only auto-provision a profile for self-serve signups that declare role=customer
  -- in their auth metadata. Courier/restaurant_partner/platform_admin profiles are
  -- created explicitly by the admin invite flow (see docs), not by this trigger.
  if coalesce(new.raw_user_meta_data ->> 'role', 'customer') = 'customer' then
    insert into public.profiles (id, full_name, phone, role)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', ''),
      new.raw_user_meta_data ->> 'phone',
      'customer'
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_customer_signup();

create index profiles_role_idx on public.profiles(role);
