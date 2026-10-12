-- place_order: an idempotent retry must match what the customer is shown now (verifier finding on
-- gate 2). Same key + same p_expected_total = the old order (a real retry); same key + a different
-- total = refused, naming the existing order, nothing written. Live body (20261012000103) + one delta.
-- Rollback: re-apply the 20261012000103 body.

CREATE OR REPLACE FUNCTION public.place_order(p_restaurant_id uuid, p_order_type text, p_payment_method text, p_items jsonb, p_delivery_address_id uuid DEFAULT NULL::uuid, p_requested_for timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text, p_catering jsonb DEFAULT NULL::jsonb, p_idempotency_key text DEFAULT NULL::text, p_expected_total numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    if v_order_id is not null then
      -- A retry must be the SAME order the customer saw: a lost response followed by a changed
      -- cart under the same key returned the old order (shown 818, charged 2378). Refuse instead.
      if p_expected_total is not null and exists (
        select 1 from public.orders o
        where o.id = v_order_id and o.order_type = 'standard'
          and abs((o.subtotal_mdl + o.delivery_fee_mdl) - p_expected_total) > 0.005
      ) then
        raise exception 'comanda a fost deja plasată cu alt total (%) — o găsești la Comenzi',
          (select order_number from public.orders where id = v_order_id);
      end if;
      return v_order_id;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'cart is empty'; end if;

  -- Scheduled window (20261008000200): 2 min skew grace; 7 days standard, 60 catering.
  if p_requested_for is not null then
    if p_requested_for < now() - interval '2 minutes' then
      raise exception 'ora programată nu poate fi în trecut';
    end if;
    if p_order_type = 'catering' then
      if p_requested_for > now() + interval '60 days' then
        raise exception 'evenimentul se poate programa cu cel mult 60 de zile înainte';
      end if;
    elsif p_requested_for > now() + interval '7 days' then
      raise exception 'livrarea se poate programa cu cel mult 7 zile înainte';
    end if;
  end if;

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
    -- C1: a pin inside the restaurant's delivery radius (no pin = assumed 6 km tariff, no drop-off point).
    if exists (select 1 from public.addresses a where a.id = p_delivery_address_id and (a.lat is null or a.lng is null)) then
      raise exception 'fixează pinul adresei pe hartă — curierul trebuie să știe exact unde livrează';
    end if;
    if not exists (
      select 1 from public.addresses a
      where a.id = p_delivery_address_id and v_restaurant.geo is not null
        and extensions.st_dwithin(v_restaurant.geo,
              extensions.st_setsrid(extensions.st_makepoint(a.lng::float8, a.lat::float8), 4326)::extensions.geography,
              v_restaurant.delivery_radius_km * 1000)
    ) then
      raise exception 'adresa este în afara zonei de livrare a restaurantului (% km)', trim_scale(v_restaurant.delivery_radius_km);
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

    -- "Epuizat" from the kitchen tablet (20261012000303): sold out for the moment the food is for.
    if v_menu_item.sold_out_until is not null and v_menu_item.sold_out_until > coalesce(p_requested_for, now()) then
      raise exception 'produsul „%” este epuizat momentan — scoate-l din coș', v_menu_item.name;
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

  -- Armata 2026-08-13: plafon COD. O comandă standard CASH peste plafonul de
  -- float al oricărui curier nu poate fi dispecerizată sub gate-ul cash-aware
  -- (ar muri în anularea de 6h) — respinge la checkout, cu alternativa card.
  if p_order_type = 'standard' and p_payment_method = 'cash'
     and (v_subtotal + v_restaurant.delivery_fee_mdl) > 1400 then
    raise exception 'comenzile peste 1400 MDL se achită cu cardul la livrare';
  end if;

  update public.orders set subtotal_mdl = v_subtotal, total_mdl = v_subtotal + delivery_fee_mdl where id = v_order_id;
  -- The customer pays what was shown: a delivery fee or menu price that changed between the
  -- checkout's read and this call refuses the order (the raise rolls the insert back).
  if p_expected_total is not null and p_order_type = 'standard'
     and abs((v_subtotal + v_restaurant.delivery_fee_mdl) - p_expected_total) > 0.005 then
    raise exception 'prețul s-a schimbat: totalul este acum % MDL', trim_scale(v_subtotal + v_restaurant.delivery_fee_mdl);
  end if;

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
$function$;
