-- Couriers. Deliberately minimal — no HR/payroll/subcontractor complexity
-- (unlike dragons-delivery-2.0's courier schema, which is out of scope here).
-- Placed before orders_and_catering because orders.courier_id references
-- couriers(id).

create table public.couriers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null,
  vehicle_type text not null check (vehicle_type in ('bike', 'e_bike', 'scooter', 'car', 'on_foot')),
  status text not null default 'offline' check (status in ('offline', 'online', 'on_delivery')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.couriers enable row level security;

create trigger couriers_set_updated_at
  before update on public.couriers
  for each row execute function public.set_updated_at();

create table public.courier_locations (
  courier_id uuid primary key references public.couriers(id) on delete cascade,
  lat numeric(9, 6) not null,
  lng numeric(9, 6) not null,
  updated_at timestamptz not null default now()
);

alter table public.courier_locations enable row level security;

create policy "couriers_self_read" on public.couriers
  for select using (user_id = auth.uid());

create policy "couriers_admin_all" on public.couriers
  for all using (has_role('platform_admin')) with check (has_role('platform_admin'));

-- NOTE: no self-UPDATE policy — online/offline toggling goes through the
-- set_courier_online_status() RPC (migration 000500), not direct table writes,
-- so a courier can't quietly flip is_active on themselves.

create policy "courier_locations_self_all" on public.courier_locations
  for all
  using (courier_id in (select id from public.couriers where user_id = auth.uid()))
  with check (courier_id in (select id from public.couriers where user_id = auth.uid()));

create policy "courier_locations_admin_read" on public.courier_locations
  for select using (has_role('platform_admin'));

-- Customer-facing read access (their assigned courier's name/phone/location
-- while an order is in flight) is added in 20260708000400_orders_and_catering.sql,
-- once the `orders` table this depends on actually exists.
