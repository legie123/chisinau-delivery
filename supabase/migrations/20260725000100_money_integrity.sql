-- ============================================================================
-- WAVE 1 — MONEY INTEGRITY  (post-audit wf_00722b5f-708: 4 criticals + coupled highs)
--
-- Root problems fixed here:
--  A. Payouts keyed off orders.created_at, not the delivery time  → catering
--     orders (quote-first, created weeks before the event) were dropped from the
--     period they were delivered in and became permanently unpayable. (#1)
--  B. Payouts never checked payment_status → unpaid online orders were paid out,
--     and online orders could be *delivered* with zero payment confirmation and
--     then vanish from every admin queue. (#2/#3/#7/#14)
--  C. set_order_tip recomputed total_mdl from the menu subtotal → it destroyed a
--     confirmed catering order's quoted total (massive undercharge). (#5/#10)
--  D. Online payment intent amount double-counted the tip / captured it before the
--     tip was set → tip either doubled or silently uncollected. (#6/#11/#15/#46)
--  E. No per-order settlement ledger → overlapping/re-run payout periods double-paid
--     the same order; restaurants were never paid for catering at all. (#9/#19/#20/#28/#32/#33/#43)
--
-- Money semantics made authoritative:
--  * order total_mdl is the single source of what the customer pays (tip included).
--  * restaurant food value  = standard: subtotal_mdl · catering: total - delivery_fee - tip
--    (the quoted food/service charge; catering's authoritative total is quoted_total_mdl,
--     stamped onto orders.total_mdl by confirm_catering_quote).
--  * courier value          = delivery_fee_mdl + tip_mdl (tips go to the courier).
--  * an order is settled AT MOST ONCE per recipient_type, forever (ledger PK).
--  * a generation run settles every unsettled delivered+PAID order through period_end,
--    so a straggler is never permanently lost — it's swept into the next run.
-- ============================================================================

-- 1. Delivery timestamp — the real basis for "which period did this order earn in".
alter table public.orders add column if not exists delivered_at timestamptz;

-- Backfill historical delivered orders from their delivered status event.
update public.orders o
set delivered_at = e.t
from (
  select order_id, max(created_at) as t
  from public.delivery_status_events
  where status = 'delivered'
  group by order_id
) e
where e.order_id = o.id and o.status = 'delivered' and o.delivered_at is null;

-- 2. Per-order settlement ledger — makes double-pay structurally impossible and
--    guarantees nothing is ever settled twice to the same recipient side.
create table if not exists public.payout_orders (
  payout_id uuid not null references public.payouts(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('courier', 'restaurant')),
  gross_mdl numeric(10, 2) not null default 0,
  primary key (order_id, recipient_type)
);
create index if not exists payout_orders_payout_idx on public.payout_orders(payout_id);
alter table public.payout_orders enable row level security;
drop policy if exists "payout_orders_admin_read" on public.payout_orders;
create policy "payout_orders_admin_read" on public.payout_orders
  for select using (has_role('platform_admin'));
-- No client write policy — only admin_generate_payouts (security definer) writes it.

-- 3. advance_delivery_status: stamp delivered_at + GATE prepaid delivery on payment.
--    An online_gateway order can NEVER be moved to 'delivered' unless it is paid —
--    that closes the silent revenue leak at the one irreversible moment (handover).
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

  update public.orders
  set status = p_new_status,
      delivered_at = case when p_new_status = 'delivered' then now() else delivered_at end,
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

-- 4. set_order_tip: adjust the total by the tip DELTA, never recompute it from the
--    subtotal. This preserves a catering order's quoted total (and a standard order's
--    base) regardless of order_type, and keeps any pending payment intent in sync.
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

  v_new_tip := round(p_tip_mdl, 2);
  -- Remove whatever tip was previously folded in, add the new one. Authoritative
  -- base (standard subtotal+fee OR catering quoted total) is left untouched.
  v_new_total := v_order.total_mdl - coalesce(v_order.tip_mdl, 0) + v_new_tip;

  update public.orders set tip_mdl = v_new_tip, total_mdl = v_new_total where id = p_order_id;

  -- Keep a still-pending online-payment intent consistent with the new total.
  update public.payment_intents
  set amount_mdl = v_new_total, updated_at = now()
  where order_id = p_order_id and status = 'pending';
end; $$;

-- 5. start_online_payment: charge exactly total_mdl (which already includes the tip).
--    The prior "+ tip_mdl" double-counted the tip.
create or replace function public.start_online_payment(p_order_id uuid)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_order public.orders%rowtype; v_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_order.payment_status = 'paid' then raise exception 'already paid'; end if;
  select id into v_id from public.payment_intents where order_id = p_order_id and status = 'pending' limit 1;
  if v_id is not null then
    -- refresh the amount in case the tip/total changed since the intent opened
    update public.payment_intents set amount_mdl = v_order.total_mdl, updated_at = now() where id = v_id;
    return v_id;
  end if;
  insert into public.payment_intents (order_id, amount_mdl, provider, status)
  values (p_order_id, v_order.total_mdl, 'mock', 'pending')
  returning id into v_id;
  update public.orders set payment_status = 'pending_capture' where id = p_order_id and payment_status = 'unpaid';
  return v_id;
end; $$;

-- 6. admin_generate_payouts v2 — keyed off delivered_at, gated on payment_status='paid',
--    covers BOTH order types, restaurants paid for catering, per-order ledger prevents
--    any double-pay across overlapping periods or re-runs.
create or replace function public.admin_generate_payouts(p_start date, p_end date)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
        v_payout_id uuid; v_commission numeric(10,2);
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_settings from public.platform_settings where id;

  -- ---- Restaurants ----
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
    on conflict (recipient_type, recipient_id, period_start, period_end) do update
      set orders_count = public.payouts.orders_count + excluded.orders_count,
          gross_mdl    = public.payouts.gross_mdl + excluded.gross_mdl,
          commission_mdl = public.payouts.commission_mdl + excluded.commission_mdl,
          net_mdl      = public.payouts.net_mdl + excluded.net_mdl
      where public.payouts.status = 'pending'
    returning id into v_payout_id;
    if v_payout_id is null then continue; end if; -- existing period already paid; leave orders unsettled for the next run
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl)
    select v_payout_id, o.id, 'restaurant',
           case when o.order_type = 'standard' then o.subtotal_mdl
                else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and o.delivered_at::date <= p_end
      and o.restaurant_id = v_c.rid
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant');
    v_n := v_n + 1;
  end loop;

  -- ---- Couriers ----  gross = delivery_fee + tip; commission taken on the fee only.
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
    on conflict (recipient_type, recipient_id, period_start, period_end) do update
      set orders_count = public.payouts.orders_count + excluded.orders_count,
          gross_mdl    = public.payouts.gross_mdl + excluded.gross_mdl,
          commission_mdl = public.payouts.commission_mdl + excluded.commission_mdl,
          net_mdl      = public.payouts.net_mdl + excluded.net_mdl
      where public.payouts.status = 'pending'
    returning id into v_payout_id;
    if v_payout_id is null then continue; end if;
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl)
    select v_payout_id, o.id, 'courier', o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id = v_c.cid
      and o.delivered_at is not null and o.delivered_at::date <= p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier');
    v_n := v_n + 1;
  end loop;

  return v_n;
end; $$;
revoke execute on function public.admin_generate_payouts(date, date) from public, anon, authenticated;
grant execute on function public.admin_generate_payouts(date, date) to authenticated; -- RPC self-checks has_role

-- 7. admin_payment_queue: also surface any DELIVERED order that isn't cleanly paid
--    (cash never collected, or an online leak) so ops can see + resolve it instead of
--    it vanishing. admin_update_payment_status already has an ('unpaid','paid') path.
create or replace view public.admin_payment_queue
with (security_invoker = on) as
select
  o.id, o.order_number, o.status, o.payment_method, o.payment_status,
  o.total_mdl, o.cancellation_reason, o.created_at, o.updated_at,
  r.name as restaurant_name, c.full_name as courier_name
from public.orders o
join public.restaurants r on r.id = o.restaurant_id
left join public.couriers c on c.id = o.courier_id
where o.payment_status in ('refund_pending', 'failed')
   or (o.status in ('cancelled', 'rejected') and o.payment_status = 'paid')
   or (o.status = 'delivered' and o.payment_status not in ('paid', 'refunded', 'refund_pending'));

grant select on public.admin_payment_queue to authenticated;
