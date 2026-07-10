-- Orders, order items, catering details. All status writes go through the
-- security-definer RPCs in 20260708000500_status_events_and_rpcs.sql —
-- deliberately no direct client INSERT/UPDATE policy on `orders` here, since
-- place_order()/accept_order()/etc. run as their owner and bypass RLS, and an
-- open insert policy would let a client skip the RPC's minimum-order and
-- restaurant-availability checks entirely.

create sequence public.order_number_seq;

create or replace function public.generate_order_number()
returns text
language sql
as $$
  select 'CHD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0');
$$;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null default public.generate_order_number(),
  order_type text not null check (order_type in ('standard', 'catering')),
  customer_id uuid not null references auth.users(id),
  restaurant_id uuid not null references public.restaurants(id),
  delivery_address_id uuid references public.addresses(id),
  status text not null default 'pending_restaurant' check (status in (
    'pending_restaurant', 'accepted', 'ready_for_pickup', 'courier_assigned',
    'picked_up', 'en_route', 'delivered', 'cancelled', 'rejected'
  )),
  payment_method text not null check (payment_method in ('cash', 'card_on_delivery', 'online_gateway')),
  payment_status text not null default 'unpaid' check (payment_status in (
    'unpaid', 'pending_capture', 'paid', 'refund_pending', 'refunded', 'failed'
  )),
  subtotal_mdl numeric(10, 2) not null default 0,
  delivery_fee_mdl numeric(10, 2) not null default 0,
  total_mdl numeric(10, 2) not null default 0,
  requested_for timestamptz,
  courier_id uuid references public.couriers(id),
  notes text,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_customer_idx on public.orders(customer_id, created_at desc);
create index orders_restaurant_status_idx on public.orders(restaurant_id, status);
create index orders_courier_idx on public.orders(courier_id) where courier_id is not null;

alter table public.orders enable row level security;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id),
  item_name_snapshot text not null,
  unit_price_mdl numeric(10, 2) not null,
  quantity int not null check (quantity > 0),
  line_total_mdl numeric(10, 2) not null,
  notes text
);

alter table public.order_items enable row level security;

create table public.catering_details (
  order_id uuid primary key references public.orders(id) on delete cascade,
  event_date date not null,
  event_time time,
  guest_count int not null check (guest_count > 0),
  event_address_text text not null,
  contact_person text not null,
  contact_phone text not null,
  quote_status text not null default 'requested' check (quote_status in ('requested', 'quoted', 'confirmed', 'declined')),
  quoted_total_mdl numeric(10, 2),
  restaurant_notes text,
  created_at timestamptz not null default now()
);

alter table public.catering_details enable row level security;

-- orders: read-only from the client side; all writes go through RPCs.
create policy "orders_customer_read_own" on public.orders
  for select using (customer_id = auth.uid());

create policy "orders_partner_scope" on public.orders
  for select using (has_restaurant_access(restaurant_id));

create policy "orders_courier_scope" on public.orders
  for select using (courier_id in (select id from public.couriers where user_id = auth.uid()));

-- Couriers must also see unassigned, ready-for-pickup orders to have
-- anything to accept — orders_courier_scope alone excludes these (courier_id
-- is null pre-assignment).
create policy "orders_courier_read_unassigned" on public.orders
  for select using (status = 'ready_for_pickup' and courier_id is null and has_role('courier'));

create policy "orders_admin_all" on public.orders
  for all using (has_role('platform_admin')) with check (has_role('platform_admin'));

create policy "order_items_scoped_read" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          o.customer_id = auth.uid()
          or has_restaurant_access(o.restaurant_id)
          or o.courier_id in (select id from public.couriers where user_id = auth.uid())
          or has_role('platform_admin')
        )
    )
  );

create policy "catering_details_scoped_read" on public.catering_details
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = catering_details.order_id
        and (o.customer_id = auth.uid() or has_restaurant_access(o.restaurant_id) or has_role('platform_admin'))
    )
  );

-- No direct UPDATE policy on catering_details: quote submission/decline
-- (partner) and quote confirmation (customer) go through the RPCs in
-- 20260708000500_status_events_and_rpcs.sql, so a client can't rewrite
-- quoted_total_mdl or self-confirm a quote via a raw .update() call.

-- Deferred from 20260708000100_couriers.sql: customers can see their
-- currently-assigned courier's contact info and live location, now that
-- `orders` exists to scope that access.
create policy "couriers_customer_scoped_read" on public.couriers
  for select using (
    id in (select courier_id from public.orders where customer_id = auth.uid() and courier_id is not null)
  );

create policy "courier_locations_customer_read" on public.courier_locations
  for select using (
    exists (
      select 1 from public.orders o
      where o.courier_id = courier_locations.courier_id
        and o.customer_id = auth.uid()
        and o.status in ('picked_up', 'en_route')
    )
  );
