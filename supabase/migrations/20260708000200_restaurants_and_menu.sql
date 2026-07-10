-- Restaurants, staff access, menu structure.

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  cuisine_type text not null check (cuisine_type in ('sushi', 'fine_dining', 'other')),
  description text,
  logo_url text,
  cover_photo_url text,
  address text not null,
  sector text,
  phone text not null,
  is_active boolean not null default true,
  accepting_orders boolean not null default true,
  accepts_catering boolean not null default false,
  delivery_fee_mdl numeric(10, 2) not null default 0 check (delivery_fee_mdl >= 0),
  min_order_amount_mdl numeric(10, 2) not null default 0 check (min_order_amount_mdl >= 0),
  catering_min_amount_mdl numeric(10, 2) check (catering_min_amount_mdl >= 0),
  avg_prep_minutes int not null default 30 check (avg_prep_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurants enable row level security;

create trigger restaurants_set_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();

create table public.restaurant_staff (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

alter table public.restaurant_staff enable row level security;

create or replace function public.has_restaurant_access(target uuid)
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select
    exists (
      select 1 from public.restaurant_staff
      where restaurant_id = target and user_id = auth.uid()
    )
    or public.has_role('platform_admin');
$$;

create policy "restaurants_public_read" on public.restaurants
  for select using (is_active = true or has_restaurant_access(id));

create policy "restaurants_staff_write" on public.restaurants
  for update using (has_restaurant_access(id)) with check (has_restaurant_access(id));

create policy "restaurants_admin_insert" on public.restaurants
  for insert with check (has_role('platform_admin'));

create policy "restaurant_staff_read" on public.restaurant_staff
  for select using (has_restaurant_access(restaurant_id));

create policy "restaurant_staff_admin_write" on public.restaurant_staff
  for all using (has_role('platform_admin')) with check (has_role('platform_admin'));

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0
);

alter table public.menu_categories enable row level security;

create policy "menu_categories_public_read" on public.menu_categories
  for select using (true);

create policy "menu_categories_staff_write" on public.menu_categories
  for all using (has_restaurant_access(restaurant_id)) with check (has_restaurant_access(restaurant_id));

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  name text not null,
  description text,
  price_mdl numeric(10, 2) not null check (price_mdl >= 0),
  photo_url text,
  is_available boolean not null default true,
  is_catering_only boolean not null default false,
  catering_min_qty int check (catering_min_qty > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.menu_items enable row level security;

create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

create index menu_items_restaurant_available_idx on public.menu_items(restaurant_id) where is_available = true;

-- Defense in depth: a deactivated restaurant's items must not be directly
-- queryable even though restaurants_public_read already hides the restaurant
-- itself from listings.
create policy "menu_items_public_read" on public.menu_items
  for select using (
    (
      is_available = true
      and exists (select 1 from public.restaurants r where r.id = menu_items.restaurant_id and r.is_active)
    )
    or has_restaurant_access(restaurant_id)
  );

create policy "menu_items_staff_write" on public.menu_items
  for all using (has_restaurant_access(restaurant_id)) with check (has_restaurant_access(restaurant_id));

create table public.restaurant_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  is_closed boolean not null default false,
  unique (restaurant_id, day_of_week)
);

alter table public.restaurant_hours enable row level security;

create policy "restaurant_hours_public_read" on public.restaurant_hours
  for select using (true);

create policy "restaurant_hours_staff_write" on public.restaurant_hours
  for all using (has_restaurant_access(restaurant_id)) with check (has_restaurant_access(restaurant_id));
