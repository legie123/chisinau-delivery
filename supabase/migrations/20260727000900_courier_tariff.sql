-- Order 2 (pilot-critical) — PER-DELIVERY COURIER TARIFF, versioned. "The fee
-- you see is a floor": mark_ready_for_pickup stamps a QUOTE the moment the
-- restaurant marks ready (base + per_km * distance, wait=0 — no waiting has
-- happened yet); advance_delivery_status stamps the FINAL fee at delivered
-- (base + per_km*dist + wait accrual), and the final can never be lower than
-- the quote (greatest()). Mirrors pricing_config's versioned/immutable
-- pattern exactly (courier-facing commercial term → open authenticated read,
-- like pricing_config, unlike the ops-internal dispatch_scoring_config).
--
-- Grounding (provisional, label 'provizoriu — de ratificat', admin-retunable
-- via set_courier_tariff): base 30 MDL + 6 MDL/km + 1.50 MDL/min wait after a
-- 3-minute grace — audit target 600-1000 MDL/tură, courier share 70-75%,
-- Chișinău fees 35-45 MDL.
--
-- Wait accrual note: the spec asks for wait computed from
-- orders.courier_arrived_restaurant_at IF that column exists. It does not
-- exist in this schema yet, so wait_minutes is hardcoded to 0 below (the
-- wait_per_min_mdl rate is still stored + versioned for the day that column
-- ships — a future migration only needs to compute v_wait_minutes, not touch
-- the tariff table or the setter).

create table if not exists public.courier_tariff_config (
  id uuid primary key default gen_random_uuid(),
  effective_from timestamptz not null default now(),
  base_mdl numeric(6,2) not null check (base_mdl >= 0),
  per_km_mdl numeric(6,2) not null check (per_km_mdl >= 0),
  wait_per_min_mdl numeric(6,2) not null check (wait_per_min_mdl >= 0),
  wait_grace_minutes int not null default 3 check (wait_grace_minutes >= 0),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.courier_tariff_config enable row level security;
-- Transparency: any authenticated user (courier included) may READ the tariff,
-- exactly like pricing_config. No insert/update/delete policies → only the
-- security-definer set_courier_tariff writes.
drop policy if exists courier_tariff_config_read on public.courier_tariff_config;
create policy courier_tariff_config_read on public.courier_tariff_config for select to authenticated using (true);

-- Seed v1 = the provisional founder numbers, effective before every existing
-- order so historical orders (no quote/final stamped) are unaffected.
insert into public.courier_tariff_config (effective_from, base_mdl, per_km_mdl, wait_per_min_mdl, wait_grace_minutes, note)
select '2026-01-01T00:00:00Z', 30.00, 6.00, 1.50, 3, 'provizoriu — de ratificat'
where not exists (select 1 from public.courier_tariff_config);

-- The tariff effective right now (latest effective_from <= now()). INTERNAL
-- ONLY (per spec) — called from mark_ready_for_pickup / advance_delivery_status
-- (security definer, so the owner can call it regardless of the revoke below);
-- never called directly from the app.
create or replace function public.current_courier_tariff()
returns public.courier_tariff_config
language sql stable security definer set search_path = public
as $$
  select * from public.courier_tariff_config where effective_from <= now() order by effective_from desc limit 1;
$$;
revoke execute on function public.current_courier_tariff() from public, anon, authenticated;

-- Retune: append a NEW immutable version, and ANNOUNCE it to every active
-- courier (tag='pricing', same outbox tag set_pricing_config uses — one feed
-- for "your money changed"). effective_from may be in the future.
create or replace function public.set_courier_tariff(
  p_base_mdl numeric, p_per_km_mdl numeric, p_wait_per_min_mdl numeric,
  p_wait_grace_minutes int default 3, p_effective_from timestamptz default now(), p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  insert into public.courier_tariff_config
    (effective_from, base_mdl, per_km_mdl, wait_per_min_mdl, wait_grace_minutes, note, created_by)
  values (p_effective_from, p_base_mdl, p_per_km_mdl, p_wait_per_min_mdl, p_wait_grace_minutes, p_note, auth.uid())
  returning id into v_id;

  insert into public.notification_outbox (user_id, title, body, url, tag)
  select c.user_id, 'Actualizare tarif curier',
         format('Tarif nou de la %s: bază %s MDL + %s MDL/km + %s MDL/min așteptare (după %s min). Tariful e mereu un minim — poate crește.',
                p_effective_from::date,
                trim(to_char(p_base_mdl, 'FM990.99')), trim(to_char(p_per_km_mdl, 'FM990.99')),
                trim(to_char(p_wait_per_min_mdl, 'FM990.99')), p_wait_grace_minutes),
         '/earnings', 'pricing'
  from public.couriers c where c.is_active;

  return v_id;
end;
$$;
revoke execute on function public.set_courier_tariff(numeric, numeric, numeric, int, timestamptz, text) from public, anon;
grant execute on function public.set_courier_tariff(numeric, numeric, numeric, int, timestamptz, text) to authenticated;

-- A published tariff version is immutable — a retune is a NEW row, never an edit.
create or replace function public.guard_courier_tariff_config_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'courier_tariff_config este imutabil — o schimbare de tarif se face cu o versiune nouă (set_courier_tariff)';
end;
$$;
drop trigger if exists guard_courier_tariff_config_immutable on public.courier_tariff_config;
create trigger guard_courier_tariff_config_immutable
  before update or delete on public.courier_tariff_config
  for each row execute function public.guard_courier_tariff_config_immutable();

-- Per-order quote (stamped at ready) + final (stamped at delivered). Both
-- nullable (unset until stamped); >=0 CHECKs mirror money_column_checks
-- (NULL passes a CHECK, so pre-existing orders are unaffected).
alter table public.orders
  add column if not exists courier_fee_quoted_mdl numeric(10,2),
  add column if not exists courier_fee_mdl numeric(10,2);

alter table public.orders
  add constraint orders_courier_fee_quoted_mdl_nonneg check (courier_fee_quoted_mdl >= 0),
  add constraint orders_courier_fee_mdl_nonneg check (courier_fee_mdl >= 0);

-- Recreate mark_ready_for_pickup (CURRENT DB body, WS2 dispatch hook
-- preserved verbatim) + stamp the courier_fee_quoted_mdl floor: base +
-- per_km * haversine(restaurant -> delivery address); missing GPS/geocode on
-- either end falls back to the same 6km default WS2 dispatch already uses
-- for a candidate with no location.
create or replace function public.mark_ready_for_pickup(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
  v_tariff public.courier_tariff_config;
  v_r_lat numeric; v_r_lng numeric; v_a_lat numeric; v_a_lng numeric;
  v_dist_km numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status = 'ready_for_pickup' then return; end if; -- idempotent
  if v_order.status <> 'accepted' then raise exception 'invalid transition from %', v_order.status; end if;

  update public.orders set status = 'ready_for_pickup' where id = p_order_id;

  -- Order 2 — quote the courier fee floor now, before dispatch offers it out.
  select lat, lng into v_r_lat, v_r_lng from public.restaurants where id = v_order.restaurant_id;
  select lat, lng into v_a_lat, v_a_lng from public.addresses where id = v_order.delivery_address_id;
  select * into v_tariff from public.current_courier_tariff();
  v_dist_km := coalesce(public.haversine_km(v_r_lat, v_r_lng, v_a_lat, v_a_lng), 6.0);
  update public.orders
    set courier_fee_quoted_mdl = round(v_tariff.base_mdl + v_tariff.per_km_mdl * v_dist_km, 2)
    where id = p_order_id;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'ready_for_pickup', (select role from public.profiles where id = auth.uid()), auth.uid());

  begin
    perform public.dispatch_order(p_order_id); -- WS2: push dispatch
  exception when others then
    raise warning 'dispatch_order(%) failed: %', p_order_id, sqlerrm; -- never block the restaurant
  end;
end;
$function$;

-- Recreate advance_delivery_status (CURRENT DB body, cash-float accrual from
-- migration 20260727000800 preserved verbatim) + stamp courier_fee_mdl at
-- delivered: greatest(quote, base + per_km*dist + wait accrual) — the quote
-- is a FLOOR, the final can only be >= it. wait_minutes is 0 (see header note
-- — orders.courier_arrived_restaurant_at does not exist yet in this schema).
create or replace function public.advance_delivery_status(p_order_id uuid, p_new_status text, p_payment_confirmed boolean default null::boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
  v_allowed text[];
  v_tariff public.courier_tariff_config;
  v_r_lat numeric; v_r_lng numeric; v_a_lat numeric; v_a_lng numeric;
  v_dist_km numeric;
  v_wait_minutes numeric;
  v_final_fee numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.courier_id not in (select id from public.couriers where user_id = auth.uid()) and not has_role('platform_admin') then
    raise exception 'not authorized';
  end if;

  if v_order.status = p_new_status then return; end if; -- idempotent retry

  v_allowed := case v_order.status
    when 'courier_assigned' then array['picked_up']
    when 'picked_up' then array['en_route']
    when 'en_route' then array['delivered']
    else array[]::text[]
  end;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'invalid transition % -> %', v_order.status, p_new_status;
  end if;

  -- MONEY GATE: a prepaid (online) order must be paid before it is handed over.
  if p_new_status = 'delivered'
     and v_order.payment_method = 'online_gateway'
     and v_order.payment_status <> 'paid' then
    raise exception 'online order % cannot be delivered before payment is confirmed (payment_status=%)',
      v_order.order_number, v_order.payment_status;
  end if;

  -- Order 2 — final courier fee, floored at the quote stamped by
  -- mark_ready_for_pickup. Distance recomputed the same way (restaurant ->
  -- delivery address, 6km fallback) in case either location changed.
  if p_new_status = 'delivered' then
    select * into v_tariff from public.current_courier_tariff();
    select lat, lng into v_r_lat, v_r_lng from public.restaurants where id = v_order.restaurant_id;
    select lat, lng into v_a_lat, v_a_lng from public.addresses where id = v_order.delivery_address_id;
    v_dist_km := coalesce(public.haversine_km(v_r_lat, v_r_lng, v_a_lat, v_a_lng), 6.0);
    v_wait_minutes := 0; -- orders.courier_arrived_restaurant_at does not exist yet
    v_final_fee := round(v_tariff.base_mdl + v_tariff.per_km_mdl * v_dist_km + v_tariff.wait_per_min_mdl * v_wait_minutes, 2);
    v_final_fee := greatest(coalesce(v_order.courier_fee_quoted_mdl, 0), v_final_fee);
  end if;

  update public.orders
  set status = p_new_status,
      delivered_at = case when p_new_status = 'delivered' then now() else delivered_at end,
      courier_fee_mdl = case when p_new_status = 'delivered' then v_final_fee else courier_fee_mdl end,
      payment_status = case
        when p_new_status = 'delivered' and p_payment_confirmed and payment_method <> 'online_gateway' then 'paid'
        else payment_status
      end
  where id = p_order_id;

  if p_new_status = 'delivered' then
    update public.couriers set status = 'online' where id = v_order.courier_id;
  end if;

  -- CASH FLOAT accrual (order 1 — COD-only pilot). ONLY payment_method='cash'
  -- accrues a liability: card_on_delivery settles electronically on a POS
  -- terminal and never sits in the courier's pocket. If this pushes the
  -- courier's float to/past the cap, enforce_cash_cap_offline (trigger on
  -- courier_cash_movements) forces them back offline right here.
  if p_new_status = 'delivered' and p_payment_confirmed and v_order.payment_method = 'cash' and v_order.total_mdl > 0 then
    insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl)
    values (v_order.courier_id, v_order.id, 'collected', v_order.total_mdl);
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, p_new_status, case when has_role('courier') then 'courier' else 'platform_admin' end, auth.uid());
end;
$function$;

-- Recreate admin_generate_payouts (CURRENT DB body) with all FIVE courier-block
-- o.delivery_fee_mdl references swapped to coalesce(o.courier_fee_mdl,
-- o.delivery_fee_mdl) — sim #11 guards this. The restaurant-block references
-- (2x, computing the restaurant's share as total - delivery_fee - tip) are
-- deliberately UNCHANGED: a customer-facing delivery_fee_mdl gap vs a higher
-- final courier_fee_mdl is a platform-absorbed cost, not something the
-- restaurant's payout should ever move for.
create or replace function public.admin_generate_payouts(p_start date, p_end date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
        v_payout_id uuid; v_commission numeric(10,2);
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  perform pg_advisory_xact_lock(hashtext('admin_generate_payouts'));
  select * into v_settings from public.platform_settings where id;

  for v_c in
    select o.restaurant_id as rid, count(*) as cnt,
           sum(case when o.order_type = 'standard' then o.subtotal_mdl
                    else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as gross
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant')
    group by o.restaurant_id
  loop
    v_commission := round(v_c.gross * v_settings.restaurant_commission_pct / 100, 2);
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('restaurant', v_c.rid, p_start, p_end, v_c.cnt, v_c.gross, v_commission, v_c.gross - v_commission)
    returning id into v_payout_id;
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'restaurant', g.gross, g.gross - round(g.gross * v_settings.restaurant_commission_pct / 100, 2)
    from public.orders o
    cross join lateral (select (case when o.order_type = 'standard' then o.subtotal_mdl
                          else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as gross) g
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
      and o.restaurant_id = v_c.rid
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant');
    v_n := v_n + 1;
  end loop;

  for v_c in
    select o.courier_id as cid, count(*) as cnt,
           sum(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0)) as gross,
           sum(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl)) as fees
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id is not null
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier')
    group by o.courier_id
  loop
    v_commission := round(v_c.fees * v_settings.courier_commission_pct / 100, 2);
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('courier', v_c.cid, p_start, p_end, v_c.cnt, v_c.gross, v_commission, v_c.gross - v_commission)
    returning id into v_payout_id;
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'courier', coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0),
           (coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0)) - round(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) * v_settings.courier_commission_pct / 100, 2)
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id = v_c.cid
      and o.delivered_at is not null and o.delivered_at::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier');
    v_n := v_n + 1;
  end loop;

  return v_n;
end; $function$;
