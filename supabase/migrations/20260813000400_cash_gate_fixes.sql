-- Armata de verificare 2026-08-13 pe 70be2ae/4d01e62 — 3 corecturi:
--
-- 1. CRIT boundary: gate-ul cash excludea doar la STRICT peste cap (>), dar
--    enforce_cash_cap_offline pedepsește la >= cap — o comandă care aterizează
--    EXACT pe cap primea ofertă și declanșa tot auto-offline-ul. Acum >=.
--
-- 2. CRIT catering: comenzile catering cash (ex. 9.200 MDL) depășesc plafonul
--    ORICĂRUI curier → sub gate deveneau permanent nedispecerizabile (mureau
--    în expirarea de 6h). Exempt: catering ocolește gate-ul de float —
--    predarea numerarului mare la evenimente e o problemă de proces
--    (factură/transfer, decizie de business din dezbatere), nu de dispatch.
--    Comenzile STANDARD rămân protejate.
--
-- 3. HIGH reconcile: un flag deschis vechi înghițea un incident NOU de drift
--    pe același curier (drift-ul se schimbă → nicio alertă nouă). Suprimarea
--    se aplică acum doar când driftul curent e apropiat de cel deja raportat
--    (delta ≤ 50 MDL); un drift materialmente diferit ridică flag nou.

create or replace function public.dispatch_order(p_order_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_cand record;
  v_wave int;
  v_offer_id uuid;
  v_cfg public.dispatch_scoring_config;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'ready_for_pickup' or v_order.courier_id is not null then
    return null;
  end if;
  if v_order.requested_for is not null and v_order.requested_for > now() + interval '45 minutes' then
    return null;
  end if;
  if exists (select 1 from public.dispatch_offers where order_id = p_order_id and status = 'offered') then
    return null;
  end if;

  select coalesce(max(wave), 0) + 1 into v_wave from public.dispatch_offers
    where order_id = p_order_id and created_at > now() - interval '5 minutes';
  if v_wave > 5 then
    return null;
  end if;

  select * into v_cfg from public.current_dispatch_scoring_config();

  select c.id as courier_id, d.dist_km,
         round(d.dist_km / v.speed_kmh * 60 * v_cfg.alpha0, 2) as score
  into v_cand
  from public.couriers c
  join public.restaurants r on r.id = v_order.restaurant_id
  left join public.courier_locations cl
    on cl.courier_id = c.id and cl.updated_at > now() - interval '10 minutes' and cl.is_plausible
  cross join lateral (
    select case c.vehicle_type
      when 'bike' then 12 when 'e_bike' then 18 when 'scooter' then 25
      when 'car' then 22 else 5 end::numeric as speed_kmh
  ) v
  cross join lateral (
    select coalesce(public.haversine_km(cl.lat, cl.lng, r.lat, r.lng), 6.0) as dist_km
  ) d
  where c.status = 'online' and c.is_active
    and public.courier_has_capacity(c.id)
    -- Cash-aware capacity (STANDARD only; >= matches the punishment trigger).
    -- Catering cash is exempt: it exceeds every cap by construction and its
    -- settlement is a business-process question, not a dispatch one.
    and not (
      v_order.payment_method = 'cash'
      and v_order.order_type = 'standard'
      and public.courier_cash_balance(c.id) + v_order.total_mdl >= public.effective_cash_cap(c.id)
    )
    and not exists (select 1 from public.dispatch_offers lo
                    where lo.courier_id = c.id and lo.status = 'offered')
    and not exists (select 1 from public.dispatch_offers po
                    where po.courier_id = c.id and po.order_id = p_order_id
                      and (po.status in ('offered','accepted','declined')
                           or (po.status = 'expired'
                               and po.expires_at > now() - interval '2 minutes')))
  order by score asc
  limit 1;

  if v_cand.courier_id is null then
    return null;
  end if;

  insert into public.dispatch_offers (order_id, courier_id, wave, score, distance_km, expires_at)
  values (p_order_id, v_cand.courier_id, v_wave, v_cand.score, v_cand.dist_km, now() + interval '30 seconds')
  returning id into v_offer_id;
  return v_offer_id;
end;
$function$;

create or replace function public.reconcile_cash_ledger()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
  v_rec record;
  v_drift numeric;
  v_admin uuid;
begin
  for v_rec in
    select
      c.id as courier_id,
      public.courier_cash_balance(c.id) as ledger_balance,
      coalesce((
        select sum(o.total_mdl) from public.orders o
        where o.courier_id = c.id and o.status = 'delivered'
          and o.payment_method = 'cash' and o.payment_status = 'paid'
      ), 0)
      + coalesce((
        select sum(m.amount_mdl) from public.courier_cash_movements m
        where m.courier_id = c.id and m.kind = 'offload'
      ), 0) as recomputed_balance
    from public.couriers c
  loop
    v_drift := v_rec.ledger_balance - v_rec.recomputed_balance;
    if abs(v_drift) > 50
       -- suppress ONLY while an open flag describes (approximately) THIS drift;
       -- a materially different new drift on the same courier flags again
       and not exists (
         select 1 from public.fraud_flags f
         where f.courier_id = v_rec.courier_id
           and f.kind = 'cash_ledger_drift'
           and f.reviewed_at is null
           and abs(coalesce((f.detail->>'drift_mdl')::numeric, 0) - v_drift) <= 50
       )
    then
      insert into public.fraud_flags (courier_id, kind, detail)
      values (
        v_rec.courier_id, 'cash_ledger_drift',
        jsonb_build_object(
          'ledger_balance', v_rec.ledger_balance,
          'recomputed_balance', v_rec.recomputed_balance,
          'drift_mdl', v_drift
        )
      );

      for v_admin in select id from public.profiles where role = 'platform_admin'
      loop
        insert into public.notification_outbox (user_id, title, body, url, tag)
        values (
          v_admin,
          'Discrepanță numerar curier',
          format('Curier %s: sold jurnal %s MDL vs. recalculat din comenzi %s MDL (diferență %s MDL).',
                 v_rec.courier_id, v_rec.ledger_balance, v_rec.recomputed_balance, v_drift),
          '/platform/fraud',
          'cash'
        );
      end loop;
    end if;
  end loop;
end;
$function$;

-- 4. Plafon COD la checkout (consecință directă a gate-ului cash-aware):
--    standard + cash + total > 1400 MDL → respins cu îndrumare spre card.
--    Recreat din corpul live, o singură verificare adăugată după min-order.
CREATE OR REPLACE FUNCTION public.place_order(p_restaurant_id uuid, p_order_type text, p_payment_method text, p_items jsonb, p_delivery_address_id uuid DEFAULT NULL::uuid, p_requested_for timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text, p_catering jsonb DEFAULT NULL::jsonb, p_idempotency_key text DEFAULT NULL::text)
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

  -- Armata 2026-08-13: plafon COD. O comandă standard CASH peste plafonul de
  -- float al oricărui curier nu poate fi dispecerizată sub gate-ul cash-aware
  -- (ar muri în anularea de 6h) — respinge la checkout, cu alternativa card.
  if p_order_type = 'standard' and p_payment_method = 'cash'
     and (v_subtotal + v_restaurant.delivery_fee_mdl) > 1400 then
    raise exception 'comenzile peste 1400 MDL se achită cu cardul la livrare';
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
$function$;
