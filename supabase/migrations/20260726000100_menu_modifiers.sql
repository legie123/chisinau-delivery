-- ============================================================================
-- MENU MODIFIERS  (BUCLA target — Bolt-Food-parity item customization)
-- A menu item can have option GROUPS (e.g. "Sos" required-pick-1, "Extra" optional-
-- pick-many); each option carries a price delta. place_order validates the chosen
-- options server-side (belong to the item, required groups satisfied, min/max
-- respected), recomputes the unit price from the DB (never trusts the client), and
-- snapshots the chosen options onto the order line.
-- ============================================================================

create table if not exists public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null,
  is_required boolean not null default false,
  min_select int not null default 0 check (min_select >= 0),
  max_select int not null default 1 check (max_select >= 1),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check (min_select <= max_select)
);
create index if not exists menu_option_groups_item_idx on public.menu_option_groups(menu_item_id);
alter table public.menu_option_groups enable row level security;

create table if not exists public.menu_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.menu_option_groups(id) on delete cascade,
  name text not null,
  price_delta_mdl numeric(10, 2) not null default 0 check (price_delta_mdl >= 0),
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists menu_options_group_idx on public.menu_options(group_id);
alter table public.menu_options enable row level security;

-- Public read: options of an available item at an active restaurant, or staff of it.
drop policy if exists "menu_option_groups_public_read" on public.menu_option_groups;
create policy "menu_option_groups_public_read" on public.menu_option_groups
  for select using (
    exists (
      select 1 from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
      where mi.id = menu_item_id and ((mi.is_available and r.is_active) or public.has_restaurant_access(r.id))
    )
  );
drop policy if exists "menu_option_groups_staff_write" on public.menu_option_groups;
create policy "menu_option_groups_staff_write" on public.menu_option_groups
  for all using (
    exists (select 1 from public.menu_items mi where mi.id = menu_item_id and public.has_restaurant_access(mi.restaurant_id))
  ) with check (
    exists (select 1 from public.menu_items mi where mi.id = menu_item_id and public.has_restaurant_access(mi.restaurant_id))
  );

drop policy if exists "menu_options_public_read" on public.menu_options;
create policy "menu_options_public_read" on public.menu_options
  for select using (
    exists (
      select 1 from public.menu_option_groups g
      join public.menu_items mi on mi.id = g.menu_item_id
      join public.restaurants r on r.id = mi.restaurant_id
      where g.id = group_id and ((mi.is_available and r.is_active) or public.has_restaurant_access(r.id))
    )
  );
drop policy if exists "menu_options_staff_write" on public.menu_options;
create policy "menu_options_staff_write" on public.menu_options
  for all using (
    exists (
      select 1 from public.menu_option_groups g join public.menu_items mi on mi.id = g.menu_item_id
      where g.id = group_id and public.has_restaurant_access(mi.restaurant_id)
    )
  ) with check (
    exists (
      select 1 from public.menu_option_groups g join public.menu_items mi on mi.id = g.menu_item_id
      where g.id = group_id and public.has_restaurant_access(mi.restaurant_id)
    )
  );

-- Order line records exactly which options were chosen + their price at order time.
alter table public.order_items add column if not exists selected_options jsonb not null default '[]'::jsonb;

-- ============================================================================
-- place_order — body preserved from 20260726000000 (idempotency + hours/address
-- gates) + per-item option validation/recompute/snapshot. Items may now carry an
-- `option_ids` uuid array; the unit price is item price + validated option deltas.
-- ============================================================================
drop function if exists public.place_order(uuid, text, text, jsonb, uuid, timestamptz, text, jsonb, text);
create or replace function public.place_order(
  p_restaurant_id uuid, p_order_type text, p_payment_method text, p_items jsonb,
  p_delivery_address_id uuid default null, p_requested_for timestamptz default null,
  p_notes text default null, p_catering jsonb default null, p_idempotency_key text default null
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
  v_unit numeric(10, 2);
  v_line_total numeric(10, 2);
  v_min numeric(10, 2);
  v_opt_ids uuid[];
  v_opt_delta numeric(10, 2);
  v_opt_snapshot jsonb;
  v_grp record;
  v_selected_in_grp int;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  if p_idempotency_key is not null then
    select id into v_order_id from public.orders
    where customer_id = auth.uid() and idempotency_key = p_idempotency_key;
    if v_order_id is not null then return v_order_id; end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'cart is empty'; end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then raise exception 'restaurant not found'; end if;
  if not v_restaurant.is_active or not v_restaurant.accepting_orders then
    raise exception 'restaurant is not currently accepting orders';
  end if;
  if p_order_type = 'catering' and (not v_restaurant.accepts_catering or p_catering is null) then
    raise exception 'invalid catering request';
  end if;

  if p_order_type = 'standard' then
    if p_delivery_address_id is null then raise exception 'adresa de livrare este obligatorie'; end if;
    if not exists (select 1 from public.addresses a where a.id = p_delivery_address_id and a.customer_id = auth.uid()) then
      raise exception 'adresa de livrare nu îți aparține';
    end if;
    if not public.restaurant_open_at(p_restaurant_id, coalesce(p_requested_for, now())) then
      raise exception 'restaurantul este închis la ora selectată';
    end if;
  end if;

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, payment_method, delivery_fee_mdl, requested_for, notes, idempotency_key)
  values (p_order_type, auth.uid(), p_restaurant_id, p_delivery_address_id, p_payment_method, v_restaurant.delivery_fee_mdl, p_requested_for, p_notes, p_idempotency_key)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu_item
    from public.menu_items
    where id = (v_item ->> 'menu_item_id')::uuid and restaurant_id = p_restaurant_id and is_available = true;
    if not found then raise exception 'menu item unavailable'; end if;

    if v_menu_item.is_catering_only and p_order_type <> 'catering' then
      raise exception 'produsul % este disponibil doar pentru catering', v_menu_item.name;
    end if;

    v_qty := (v_item ->> 'quantity')::int;
    if v_qty <= 0 or (v_menu_item.catering_min_qty is not null and v_qty < v_menu_item.catering_min_qty) then
      raise exception 'invalid quantity for %', v_menu_item.name;
    end if;

    -- ---- options: validate, recompute delta, snapshot ----
    v_opt_ids := coalesce((select array_agg((e)::uuid) from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) e), '{}');
    v_opt_delta := 0;
    v_opt_snapshot := '[]'::jsonb;

    -- every chosen option must be an available option in a group of THIS item
    if array_length(v_opt_ids, 1) is not null then
      if exists (
        select 1 from unnest(v_opt_ids) oid
        where not exists (
          select 1 from public.menu_options o
          join public.menu_option_groups g on g.id = o.group_id
          where o.id = oid and o.is_available and g.menu_item_id = v_menu_item.id
        )
      ) then
        raise exception 'opțiune invalidă pentru %', v_menu_item.name;
      end if;
    end if;

    -- required/min/max per group
    for v_grp in select * from public.menu_option_groups where menu_item_id = v_menu_item.id loop
      select count(*) into v_selected_in_grp
      from public.menu_options o where o.group_id = v_grp.id and o.id = any(v_opt_ids);
      if v_grp.is_required and v_selected_in_grp < greatest(v_grp.min_select, 1) then
        raise exception 'alege o opțiune la "%" pentru %', v_grp.name, v_menu_item.name;
      end if;
      if v_selected_in_grp < v_grp.min_select then
        raise exception 'prea puține opțiuni la "%"', v_grp.name;
      end if;
      if v_selected_in_grp > v_grp.max_select then
        raise exception 'prea multe opțiuni la "%"', v_grp.name;
      end if;
    end loop;

    -- delta + snapshot from the DB (authoritative prices, not the client)
    select coalesce(sum(o.price_delta_mdl), 0),
           coalesce(jsonb_agg(jsonb_build_object('group', g.name, 'name', o.name, 'price_delta_mdl', o.price_delta_mdl) order by g.sort_order, o.sort_order), '[]'::jsonb)
    into v_opt_delta, v_opt_snapshot
    from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
    where o.id = any(v_opt_ids);

    v_unit := v_menu_item.price_mdl + v_opt_delta;
    v_line_total := v_unit * v_qty;
    insert into public.order_items (order_id, menu_item_id, item_name_snapshot, unit_price_mdl, quantity, line_total_mdl, selected_options)
    values (v_order_id, v_menu_item.id, v_menu_item.name, v_unit, v_qty, v_line_total, v_opt_snapshot);
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_min := case when p_order_type = 'catering' then v_restaurant.catering_min_amount_mdl else v_restaurant.min_order_amount_mdl end;
  if v_min is not null and v_subtotal < v_min then
    raise exception 'subtotal % MDL below minimum % MDL', v_subtotal, v_min;
  end if;

  update public.orders set subtotal_mdl = v_subtotal, total_mdl = v_subtotal + delivery_fee_mdl where id = v_order_id;

  if p_order_type = 'catering' then
    insert into public.catering_details (order_id, event_date, event_time, guest_count, event_address_text, contact_person, contact_phone)
    values (v_order_id, (p_catering ->> 'event_date')::date, nullif(p_catering ->> 'event_time', '')::time,
            (p_catering ->> 'guest_count')::int, p_catering ->> 'event_address_text',
            p_catering ->> 'contact_person', p_catering ->> 'contact_phone');
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_order_id, 'pending_restaurant', 'customer', auth.uid());
  return v_order_id;
end;
$$;
revoke execute on function public.place_order(uuid, text, text, jsonb, uuid, timestamptz, text, jsonb, text) from public, anon;
grant execute on function public.place_order(uuid, text, text, jsonb, uuid, timestamptz, text, jsonb, text) to authenticated;

grant select on public.menu_option_groups, public.menu_options to anon, authenticated;
grant insert, update, delete on public.menu_option_groups, public.menu_options to authenticated;
