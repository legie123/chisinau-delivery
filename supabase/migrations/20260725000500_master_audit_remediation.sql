-- ============================================================================
-- WAVE 8 — MASTER-AUDIT REMEDIATION  (wf_0f39c4d6-749)
-- The adversarial master audit found what two prior money rounds missed + edge
-- cases in today's waves. Backend fixes here; code/seed fixes accompany.
--
--  #1/#34 [CRITICAL] set_order_tip after an online charge is CAPTURED inflates
--     total/tip while the captured amount stays frozen → courier paid a tip the
--     platform never collected. Directly exploitable by any customer on their order.
--  #6/#7 [HIGH] An online order stuck at pending_capture past acceptance can never
--     be delivered (gate needs paid) AND the admin payment matrix had no
--     pending_capture escape → permanent dead-end. Add reconciliation transitions.
--  #4/#15 [HIGH] restaurant_open_at only matched the query day's own row, so the
--     post-midnight portion of an overnight window (stored under the PREVIOUS day)
--     was never reached — a 22:00–02:00 kitchen read "closed" at 01:00.
--  #24/#30 [LOW] clawback recomputed amounts from the live order + current
--     commission % instead of reversing what was actually settled in the ledger.
--  #28 [LOW] slug-uniquify loop had no iteration cap.
--  #33 [LOW] search_menu_items interpolated user input into ILIKE without escaping
--     % and _ wildcards.
-- ============================================================================

-- #1/#34 — freeze the tip once an online order is captured.
create or replace function public.set_order_tip(p_order_id uuid, p_tip_mdl numeric)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_order public.orders%rowtype; v_new_tip numeric(10,2); v_new_total numeric(10,2);
begin
  if p_tip_mdl is null or p_tip_mdl < 0 then raise exception 'invalid tip'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status in ('delivered', 'cancelled', 'rejected') then raise exception 'too late to tip'; end if;
  -- #1/#34: an online charge is already captured — the total is locked to what was
  -- collected. (Cash/card_on_delivery collect at handover, so they stay editable.)
  if v_order.payment_method = 'online_gateway' and v_order.payment_status = 'paid' then
    raise exception 'bacșișul nu mai poate fi modificat după ce plata online a fost efectuată';
  end if;

  v_new_tip := round(p_tip_mdl, 2);
  v_new_total := v_order.total_mdl - coalesce(v_order.tip_mdl, 0) + v_new_tip;
  update public.orders set tip_mdl = v_new_tip, total_mdl = v_new_total where id = p_order_id;
  update public.payment_intents
  set amount_mdl = v_new_total, updated_at = now()
  where order_id = p_order_id and status = 'pending';
end; $$;

-- #6/#7 — give the admin a way to resolve a stuck online order: capture-confirm
-- (reconciliation) or fail it so the customer can retry. Full matrix recreated.
create or replace function public.admin_update_payment_status(
  p_order_id uuid, p_new_status text, p_note text default null
)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_order public.orders%rowtype; v_allowed boolean;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.payment_status = p_new_status then return; end if;

  v_allowed := (v_order.payment_status, p_new_status) in (
    ('paid', 'refund_pending'),
    ('refund_pending', 'refunded'),
    ('refund_pending', 'paid'),
    ('failed', 'unpaid'),
    ('unpaid', 'paid'),
    ('pending_capture', 'paid'),    -- #6/#7: gateway confirmed out-of-band → unblock delivery
    ('pending_capture', 'failed'),  -- #6/#7: gateway abandoned/failed → customer can retry
    ('pending_capture', 'unpaid')   -- reset a stale intent
  );
  if not v_allowed then
    raise exception 'invalid payment transition % -> %', v_order.payment_status, p_new_status;
  end if;

  update public.orders set payment_status = p_new_status where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, v_order.status, 'platform_admin', auth.uid(),
          format('payment: %s -> %s%s', v_order.payment_status, p_new_status, coalesce(' — ' || p_note, '')));
end; $$;

-- #4/#15 — overnight-aware open check: today's window OR the previous day's window
-- that spills past midnight into today.
create or replace function public.restaurant_open_at(p_restaurant_id uuid, p_at timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  with n as (
    select extract(dow from (p_at at time zone 'Europe/Chisinau'))::int as dow,
           (p_at at time zone 'Europe/Chisinau')::time as t
  )
  select exists (
    select 1
    from public.restaurant_hours h, n
    where h.restaurant_id = p_restaurant_id and not h.is_closed
      and (
        -- window that belongs to today (same-day OR today's overnight-evening part)
        (h.day_of_week = n.dow and case
            when h.closes_at > h.opens_at then n.t between h.opens_at and h.closes_at
            else n.t >= h.opens_at
          end)
        or
        -- previous day's overnight window still running after midnight
        (h.day_of_week = (n.dow + 6) % 7 and h.closes_at <= h.opens_at and n.t <= h.closes_at)
      )
  );
$$;

-- #24/#30 — store the per-order NET at settlement so a clawback reverses EXACTLY
-- what the recipient received, immune to later commission-% changes.
alter table public.payout_orders add column if not exists net_mdl numeric(10,2) not null default 0;

create or replace function public.admin_generate_payouts(p_start date, p_end date)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
        v_payout_id uuid; v_commission numeric(10,2);
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_settings from public.platform_settings where id;

  for v_c in
    select o.restaurant_id as rid, count(*) as cnt,
           sum(case when o.order_type = 'standard' then o.subtotal_mdl
                    else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as gross
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and o.delivered_at::date <= p_end
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
      and o.delivered_at is not null and o.delivered_at::date <= p_end
      and o.restaurant_id = v_c.rid
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant');
    v_n := v_n + 1;
  end loop;

  for v_c in
    select o.courier_id as cid, count(*) as cnt,
           sum(o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)) as gross,
           sum(o.delivery_fee_mdl) as fees
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id is not null
      and o.delivered_at is not null and o.delivered_at::date <= p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier')
    group by o.courier_id
  loop
    v_commission := round(v_c.fees * v_settings.courier_commission_pct / 100, 2);
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('courier', v_c.cid, p_start, p_end, v_c.cnt, v_c.gross, v_commission, v_c.gross - v_commission)
    returning id into v_payout_id;
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'courier', o.delivery_fee_mdl + coalesce(o.tip_mdl, 0),
           (o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)) - round(o.delivery_fee_mdl * v_settings.courier_commission_pct / 100, 2)
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id = v_c.cid
      and o.delivered_at is not null and o.delivered_at::date <= p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier');
    v_n := v_n + 1;
  end loop;

  return v_n;
end; $$;
revoke execute on function public.admin_generate_payouts(date, date) from public, anon, authenticated;
grant execute on function public.admin_generate_payouts(date, date) to authenticated;

-- clawback reverses the exact stored gross + net from the ledger (no live recompute).
create or replace function public.clawback_settled_order_on_refund()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_gross numeric(10,2); v_net numeric(10,2);
begin
  if new.payment_status <> 'refunded' or old.payment_status is not distinct from 'refunded' then
    return new;
  end if;

  select gross_mdl, net_mdl into v_gross, v_net from public.payout_orders
   where order_id = new.id and recipient_type = 'restaurant' and reversed_at is null;
  if found then
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl, status)
    values ('restaurant', new.restaurant_id, current_date, current_date, -1, -v_gross, -(v_gross - v_net), -v_net, 'pending');
    update public.payout_orders set reversed_at = now() where order_id = new.id and recipient_type = 'restaurant';
  end if;

  select gross_mdl, net_mdl into v_gross, v_net from public.payout_orders
   where order_id = new.id and recipient_type = 'courier' and reversed_at is null;
  if found then
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl, status)
    values ('courier', new.courier_id, current_date, current_date, -1, -v_gross, -(v_gross - v_net), -v_net, 'pending');
    update public.payout_orders set reversed_at = now() where order_id = new.id and recipient_type = 'courier';
  end if;

  return new;
end; $$;

-- #33 — escape ILIKE wildcards in the user query so % / _ are literal.
create or replace function public.search_menu_items(p_query text)
returns table (
  item_id uuid, item_name text, item_description text, price_mdl numeric,
  photo_url text, restaurant_id uuid, restaurant_slug text, restaurant_name text, cuisine_type text
)
language sql stable security invoker set search_path = public
as $$
  select mi.id, mi.name, mi.description, mi.price_mdl, mi.photo_url,
         r.id, r.slug, r.name, r.cuisine_type
  from public.menu_items mi
  join public.restaurants r on r.id = mi.restaurant_id
  where length(trim(p_query)) >= 2
    and mi.is_available = true and mi.is_catering_only = false and r.is_active = true
    and (
      mi.name ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or mi.description ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
  order by
    (mi.name ilike replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%') desc,
    mi.name asc
  limit 30;
$$;
grant execute on function public.search_menu_items(text) to anon, authenticated;

-- #28 — cap the slug-uniquify loop.
create or replace function public.review_onboarding_application(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_app public.onboarding_applications%rowtype; v_rid uuid; v_slug text; v_base text; v_n int := 0;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_app from public.onboarding_applications where id = p_id for update;
  if not found then raise exception 'application not found'; end if;
  if v_app.status <> 'pending' then raise exception 'already reviewed'; end if;

  if not p_approve then
    update public.onboarding_applications set status = 'rejected', review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
    return;
  end if;
  if v_app.user_id is null then raise exception 'applicant user missing'; end if;

  if v_app.applicant_type = 'courier' then
    update public.profiles set role = 'courier' where id = v_app.user_id;
    insert into public.couriers (user_id, full_name, phone, vehicle_type, status, is_active)
    values (v_app.user_id, v_app.full_name, v_app.phone, coalesce(v_app.details ->> 'vehicle_type', 'car'), 'offline', true)
    on conflict (user_id) do nothing;
  else
    update public.profiles set role = 'restaurant_partner' where id = v_app.user_id;
    v_base := nullif(regexp_replace(lower(coalesce(v_app.details ->> 'slug', v_app.details ->> 'name', v_app.full_name)), '[^a-z0-9]+', '-', 'g'), '');
    v_base := coalesce(trim(both '-' from v_base), 'rest-' || left(v_app.id::text, 8));
    v_slug := v_base;
    while exists (select 1 from public.restaurants where slug = v_slug) and v_n < 100 loop
      v_n := v_n + 1; v_slug := v_base || '-' || v_n;
    end loop;
    if v_n >= 100 then v_slug := v_base || '-' || left(v_app.id::text, 8); end if;  -- guaranteed-unique fallback
    insert into public.restaurants (slug, name, cuisine_type, address, sector, phone, is_active, accepting_orders, delivery_fee_mdl, min_order_amount_mdl, avg_prep_minutes)
    values (
      v_slug,
      coalesce(v_app.details ->> 'name', v_app.full_name),
      case when v_app.details ->> 'cuisine_type' in ('sushi','fine_dining','other') then v_app.details ->> 'cuisine_type' else 'other' end,
      coalesce(v_app.details ->> 'address', ''), v_app.details ->> 'sector', v_app.phone, false, false,
      least(greatest(coalesce((v_app.details ->> 'delivery_fee_mdl')::numeric, 40), 0), 200),
      least(greatest(coalesce((v_app.details ->> 'min_order_amount_mdl')::numeric, 150), 0), 1000),
      least(greatest(coalesce((v_app.details ->> 'avg_prep_minutes')::int, 30), 5), 180)
    ) returning id into v_rid;
    insert into public.restaurant_staff (user_id, restaurant_id) values (v_app.user_id, v_rid) on conflict do nothing;
  end if;

  update public.onboarding_applications set status = 'approved', review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
end; $$;
