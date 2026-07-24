-- ============================================================================
-- WAVE 1b — MONEY INTEGRITY round 2  (adversarial verifier MoneyVerify broke W1)
--
-- W1's core held (double-pay impossible, tip once, courier can't deliver online-unpaid,
-- rounding exact). These 5 residual money-wrong paths survived and are fixed here:
--
--  #1 [HIGH] Refund/chargeback AFTER settlement was never clawed back — platform
--     refunded the customer AND kept already-paid recipients whole, invisibly.
--  #2 [MED] A straggler whose (recipient,period) payout was already PAID was silently
--     dropped on a same-period re-run (the `if v_payout_id is null then continue`).
--  #3 [MED] A catering tip set during the quote phase was overwritten by
--     confirm_catering_quote (total := quoted_total), shorting the restaurant.
--  #4 [edge] platform_admin could bypass the payment gate + delivered_at stamp with a
--     direct UPDATE (orders_admin_all is FOR ALL) → unpaid delivery / delivered_at NULL
--     → permanently unpayable. Enforcement moved into a trigger, not just the RPC.
--  #5 [low] A catering quote below the delivery fee floored the restaurant to 0 while
--     the courier was still paid the fee+tip.
-- ============================================================================

-- #4 — enforce the delivery-money invariants on EVERY path (RPC or direct admin UPDATE).
--     BEFORE UPDATE so it also stamps delivered_at and blocks unpaid online handover.
create or replace function public.enforce_delivery_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    if new.payment_method = 'online_gateway' and new.payment_status <> 'paid' then
      raise exception 'order % cannot be delivered before payment is confirmed (payment_status=%)',
        new.order_number, new.payment_status;
    end if;
    if new.delivered_at is null then
      new.delivered_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_enforce_delivery_invariants on public.orders;
create trigger orders_enforce_delivery_invariants
  before update on public.orders
  for each row execute function public.enforce_delivery_invariants();

-- #3 — confirm_catering_quote must add the tip ON TOP of the quoted total (W1 made
--     total_mdl authoritative and defined catering food = total - fee - tip).
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
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status <> 'pending_restaurant' then
    raise exception 'invalid transition from % — comanda nu mai poate fi confirmată', v_order.status;
  end if;

  select * into v_details from public.catering_details where order_id = p_order_id;
  if not found or v_details.quote_status <> 'quoted' then raise exception 'no active quote to confirm'; end if;

  update public.catering_details set quote_status = 'confirmed' where order_id = p_order_id;
  update public.orders
    set status = 'accepted',
        total_mdl = v_details.quoted_total_mdl + coalesce(v_order.tip_mdl, 0)  -- tip on top, not overwritten
    where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', 'customer', auth.uid());
end;
$$;

-- #5 — a catering quote below the delivery fee makes restaurant food value negative
--     (floored to 0) while the courier still collects fee+tip. Require quote >= fee.
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
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.order_type <> 'catering' then raise exception 'not a catering order'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status <> 'pending_restaurant' then raise exception 'comanda nu mai este activă'; end if;

  select * into v_details from public.catering_details where order_id = p_order_id;
  if not found or v_details.quote_status <> 'requested' then raise exception 'quote already submitted'; end if;
  if p_quoted_total_mdl <= 0 then raise exception 'invalid quote amount'; end if;
  if p_quoted_total_mdl < v_order.delivery_fee_mdl then
    raise exception 'quote % is below the delivery fee % — restaurant share would be negative',
      p_quoted_total_mdl, v_order.delivery_fee_mdl;
  end if;

  update public.catering_details set quote_status = 'quoted', quoted_total_mdl = p_quoted_total_mdl where order_id = p_order_id;
end;
$$;

-- #2 — drop the (recipient,period) unique constraint. The payout_orders ledger PK is
--     now the sole idempotency guarantee (an order settles once per recipient, ever),
--     so generation can always create a fresh PENDING payout for whatever is unsettled
--     — stragglers into an already-paid period get their own row instead of vanishing.
alter table public.payouts drop constraint if exists payouts_recipient_type_recipient_id_period_start_period_end_key;

-- #1 — settlement reversal ledger marker + clawback on refund.
alter table public.payout_orders add column if not exists reversed_at timestamptz;

create or replace function public.admin_generate_payouts(p_start date, p_end date)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
        v_payout_id uuid; v_commission numeric(10,2);
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_settings from public.platform_settings where id;

  -- ---- Restaurants: one fresh pending payout per recipient with unsettled orders ----
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

  -- ---- Couriers ----
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
grant execute on function public.admin_generate_payouts(date, date) to authenticated;

-- Clawback: when a SETTLED order is refunded, emit offsetting NEGATIVE payout rows so
-- the recipients' balance reflects the reversal, and mark the ledger rows reversed so
-- it can't double-claw. SECURITY DEFINER so it can write regardless of the refund path.
create or replace function public.clawback_settled_order_on_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_s public.platform_settings%rowtype; v_food numeric(10,2); v_comm numeric(10,2);
        v_gross numeric(10,2);
begin
  if new.payment_status <> 'refunded' or old.payment_status is not distinct from 'refunded' then
    return new;
  end if;
  select * into v_s from public.platform_settings where id;

  -- restaurant side
  if exists (select 1 from public.payout_orders po where po.order_id = new.id and po.recipient_type = 'restaurant' and po.reversed_at is null) then
    v_food := case when new.order_type = 'standard' then new.subtotal_mdl
                   else greatest(new.total_mdl - new.delivery_fee_mdl - coalesce(new.tip_mdl,0), 0) end;
    v_comm := round(v_food * v_s.restaurant_commission_pct / 100, 2);
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl, status)
    values ('restaurant', new.restaurant_id, current_date, current_date, -1, -v_food, -v_comm, -(v_food - v_comm), 'pending');
    update public.payout_orders set reversed_at = now() where order_id = new.id and recipient_type = 'restaurant';
  end if;

  -- courier side
  if new.courier_id is not null
     and exists (select 1 from public.payout_orders po where po.order_id = new.id and po.recipient_type = 'courier' and po.reversed_at is null) then
    v_gross := new.delivery_fee_mdl + coalesce(new.tip_mdl,0);
    v_comm := round(new.delivery_fee_mdl * v_s.courier_commission_pct / 100, 2);
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl, status)
    values ('courier', new.courier_id, current_date, current_date, -1, -v_gross, -v_comm, -(v_gross - v_comm), 'pending');
    update public.payout_orders set reversed_at = now() where order_id = new.id and recipient_type = 'courier';
  end if;

  return new;
end; $$;
drop trigger if exists orders_clawback_on_refund on public.orders;
create trigger orders_clawback_on_refund
  after update on public.orders
  for each row execute function public.clawback_settled_order_on_refund();

-- Keep refunded/disputed orders that WERE settled visible so ops can action the clawback.
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
   or (o.status = 'delivered' and o.payment_status not in ('paid', 'refunded', 'refund_pending'))
   or (o.payment_status = 'refunded' and exists (select 1 from public.payout_orders po where po.order_id = o.id));

grant select on public.admin_payment_queue to authenticated;
