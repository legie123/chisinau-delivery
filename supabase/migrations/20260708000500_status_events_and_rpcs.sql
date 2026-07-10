-- Delivery status audit trail + every state-changing RPC. Every RPC below
-- checks BOTH transition validity AND caller authorization — security
-- definer functions bypass RLS internally, so skipping the authorization
-- check would let any authenticated user act on someone else's order.

create table public.delivery_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null,
  actor_role text not null check (actor_role in ('customer', 'restaurant_partner', 'courier', 'platform_admin', 'system')),
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index delivery_status_events_order_idx on public.delivery_status_events(order_id, created_at);

alter table public.delivery_status_events enable row level security;

create policy "delivery_status_events_scoped_read" on public.delivery_status_events
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = delivery_status_events.order_id
        and (
          o.customer_id = auth.uid()
          or has_restaurant_access(o.restaurant_id)
          or o.courier_id in (select id from public.couriers where user_id = auth.uid())
          or has_role('platform_admin')
        )
    )
  );

-- Deliberately no insert policy — rows are written only by the RPCs below
-- (security definer, bypass RLS as their owner), so no actor can forge
-- history entries via a direct client insert.

-- ============================================================
-- place_order — the real checkout boundary. Re-validates everything the
-- checkout UI already checked client-side, since a client-side-only check
-- is bypassable via a direct supabase.rpc() call.
-- ============================================================
create or replace function public.place_order(
  p_restaurant_id uuid,
  p_order_type text,
  p_payment_method text,
  p_items jsonb,
  p_delivery_address_id uuid default null,
  p_requested_for timestamptz default null,
  p_notes text default null,
  p_catering jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_order_id uuid;
  v_subtotal numeric(10, 2) := 0;
  v_item jsonb;
  v_menu_item public.menu_items%rowtype;
  v_qty int;
  v_line_total numeric(10, 2);
  v_min numeric(10, 2);
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'cart is empty';
  end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'restaurant not found';
  end if;
  if not v_restaurant.is_active or not v_restaurant.accepting_orders then
    raise exception 'restaurant is not currently accepting orders';
  end if;
  if p_order_type = 'catering' and (not v_restaurant.accepts_catering or p_catering is null) then
    raise exception 'invalid catering request';
  end if;

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, payment_method, delivery_fee_mdl, requested_for, notes)
  values (p_order_type, auth.uid(), p_restaurant_id, p_delivery_address_id, p_payment_method, v_restaurant.delivery_fee_mdl, p_requested_for, p_notes)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu_item
    from public.menu_items
    where id = (v_item ->> 'menu_item_id')::uuid
      and restaurant_id = p_restaurant_id
      and is_available = true;

    if not found then
      raise exception 'menu item unavailable';
    end if;

    v_qty := (v_item ->> 'quantity')::int;
    if v_qty <= 0 or (v_menu_item.catering_min_qty is not null and v_qty < v_menu_item.catering_min_qty) then
      raise exception 'invalid quantity for %', v_menu_item.name;
    end if;

    v_line_total := v_menu_item.price_mdl * v_qty;
    insert into public.order_items (order_id, menu_item_id, item_name_snapshot, unit_price_mdl, quantity, line_total_mdl)
    values (v_order_id, v_menu_item.id, v_menu_item.name, v_menu_item.price_mdl, v_qty, v_line_total);

    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_min := case when p_order_type = 'catering' then v_restaurant.catering_min_amount_mdl else v_restaurant.min_order_amount_mdl end;
  if v_min is not null and v_subtotal < v_min then
    raise exception 'subtotal % MDL below minimum % MDL', v_subtotal, v_min;
  end if;

  update public.orders set subtotal_mdl = v_subtotal, total_mdl = v_subtotal + delivery_fee_mdl where id = v_order_id;

  if p_order_type = 'catering' then
    insert into public.catering_details (order_id, event_date, event_time, guest_count, event_address_text, contact_person, contact_phone)
    values (
      v_order_id,
      (p_catering ->> 'event_date')::date,
      nullif(p_catering ->> 'event_time', '')::time,
      (p_catering ->> 'guest_count')::int,
      p_catering ->> 'event_address_text',
      p_catering ->> 'contact_person',
      p_catering ->> 'contact_phone'
    );
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_order_id, 'pending_restaurant', 'customer', auth.uid());

  return v_order_id;
end;
$$;

-- ============================================================
-- Restaurant-side order transitions
-- ============================================================
create or replace function public.accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status <> 'pending_restaurant' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders set status = 'accepted' where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', (select role from public.profiles where id = auth.uid()), auth.uid());
end;
$$;

create or replace function public.reject_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status <> 'pending_restaurant' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders set status = 'rejected', cancellation_reason = p_reason where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'rejected', (select role from public.profiles where id = auth.uid()), auth.uid(), p_reason);
end;
$$;

create or replace function public.mark_ready_for_pickup(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status <> 'accepted' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders set status = 'ready_for_pickup' where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'ready_for_pickup', (select role from public.profiles where id = auth.uid()), auth.uid());
end;
$$;

-- ============================================================
-- Courier-side order transitions
-- ============================================================
create or replace function public.assign_courier(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_courier_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;

  -- MVP simplification: one active delivery per courier at a time.
  if exists (
    select 1 from public.orders
    where courier_id = v_courier_id and status in ('courier_assigned', 'picked_up', 'en_route')
  ) then
    raise exception 'you already have an active delivery';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    raise exception 'order not available for assignment';
  end if;

  update public.orders set status = 'courier_assigned', courier_id = v_courier_id where id = p_order_id;
  update public.couriers set status = 'on_delivery' where id = v_courier_id;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

create or replace function public.advance_delivery_status(p_order_id uuid, p_new_status text, p_payment_confirmed boolean default null)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_allowed text[];
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;

  if v_order.courier_id not in (select id from public.couriers where user_id = auth.uid()) and not has_role('platform_admin') then
    raise exception 'not authorized';
  end if;

  v_allowed := case v_order.status
    when 'courier_assigned' then array['picked_up']
    when 'picked_up' then array['en_route']
    when 'en_route' then array['delivered']
    else array[]::text[]
  end;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'invalid transition % -> %', v_order.status, p_new_status;
  end if;

  update public.orders
  set status = p_new_status,
      payment_status = case
        when p_new_status = 'delivered' and p_payment_confirmed and payment_method <> 'online_gateway' then 'paid'
        else payment_status
      end
  where id = p_order_id;

  if p_new_status = 'delivered' then
    update public.couriers set status = 'online' where id = v_order.courier_id;
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, p_new_status, case when has_role('courier') then 'courier' else 'platform_admin' end, auth.uid());
end;
$$;

create or replace function public.set_courier_online_status(p_status text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if p_status not in ('offline', 'online') then raise exception 'invalid status'; end if;
  update public.couriers set status = p_status where user_id = auth.uid() and is_active;
end;
$$;

-- ============================================================
-- Cancellation (customer, pre-acceptance only; platform_admin, any time)
-- ============================================================
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;

  if v_order.customer_id = auth.uid() then
    if v_order.status <> 'pending_restaurant' then raise exception 'too late to cancel'; end if;
  elsif not has_role('platform_admin') then
    raise exception 'not authorized';
  end if;

  update public.orders set status = 'cancelled', cancellation_reason = p_reason where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'cancelled', case when has_role('platform_admin') then 'platform_admin' else 'customer' end, auth.uid(), p_reason);
end;
$$;

-- ============================================================
-- Catering quote flow — replaces a raw UPDATE policy on catering_details so
-- neither side can rewrite quoted_total_mdl or self-confirm via a direct
-- client write.
-- ============================================================
create or replace function public.submit_catering_quote(p_order_id uuid, p_quoted_total_mdl numeric)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_details public.catering_details%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.order_type <> 'catering' then raise exception 'not a catering order'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;

  select * into v_details from public.catering_details where order_id = p_order_id;
  if not found or v_details.quote_status <> 'requested' then raise exception 'quote already submitted'; end if;
  if p_quoted_total_mdl <= 0 then raise exception 'invalid quote amount'; end if;

  update public.catering_details set quote_status = 'quoted', quoted_total_mdl = p_quoted_total_mdl where order_id = p_order_id;
end;
$$;

create or replace function public.decline_catering_quote(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.order_type <> 'catering' then raise exception 'not a catering order'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;

  update public.catering_details set quote_status = 'declined', restaurant_notes = p_reason where order_id = p_order_id;
  update public.orders set status = 'rejected', cancellation_reason = p_reason where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, 'rejected', (select role from public.profiles where id = auth.uid()), auth.uid(), p_reason);
end;
$$;

create or replace function public.confirm_catering_quote(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_details public.catering_details%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.customer_id <> auth.uid() then raise exception 'not authorized'; end if;

  select * into v_details from public.catering_details where order_id = p_order_id;
  if not found or v_details.quote_status <> 'quoted' then raise exception 'no active quote to confirm'; end if;

  update public.catering_details set quote_status = 'confirmed' where order_id = p_order_id;
  update public.orders set status = 'accepted', total_mdl = v_details.quoted_total_mdl where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', 'customer', auth.uid());
end;
$$;

grant execute on function public.place_order(uuid, text, text, jsonb, uuid, timestamptz, text, jsonb) to authenticated;
grant execute on function public.accept_order(uuid) to authenticated;
grant execute on function public.reject_order(uuid, text) to authenticated;
grant execute on function public.mark_ready_for_pickup(uuid) to authenticated;
grant execute on function public.assign_courier(uuid) to authenticated;
grant execute on function public.advance_delivery_status(uuid, text, boolean) to authenticated;
grant execute on function public.set_courier_online_status(text) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.submit_catering_quote(uuid, numeric) to authenticated;
grant execute on function public.decline_catering_quote(uuid, text) to authenticated;
grant execute on function public.confirm_catering_quote(uuid) to authenticated;
