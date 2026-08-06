-- ============================================================================
-- MARELE AUDIT 2026-08-03 — MoneySectorAudit #2 (P1)
--
-- A cash order books a 'collected' courier_cash_movement of total_mdl at
-- delivery (toward the courier's float cap). If that order is later refunded,
-- clawback_settled_order_on_refund reversed the payout ledger but NEVER touched
-- courier_cash_movements — so the courier's held-cash balance stayed inflated by
-- the refunded amount. Consequences: a false cap hit (unfair auto-offline / no
-- reactivation) and a PERMANENT drift alarm in reconcile_cash_ledger (which
-- recomputes expected cash from PAID orders + offloads — a refunded order drops
-- out of that sum, but the ledger's +collected stayed, so drift = the refund,
-- flagged every hourly run until fixed by hand).
--
-- Fix: a new 'refund_reversal' movement kind (amount < 0). On refund of a cash
-- order, clawback inserts a negative movement equal to what was collected for
-- that order, per collecting courier (robust to a reassign between collection
-- and refund), idempotent. The ledger balance then drops by exactly the refund,
-- realigning it with reconcile's PAID-orders recompute — no reconcile change
-- needed (a refunded order contributes 0 to both sides).
-- ============================================================================

alter table public.courier_cash_movements drop constraint courier_cash_movements_kind_check;
alter table public.courier_cash_movements add constraint courier_cash_movements_kind_check
  check (kind = any (array['collected', 'offload', 'refund_reversal']));

alter table public.courier_cash_movements drop constraint courier_cash_movements_check;
alter table public.courier_cash_movements add constraint courier_cash_movements_check
  check (
       (kind = 'collected'       and amount_mdl > 0)
    or (kind = 'offload'         and amount_mdl < 0)
    or (kind = 'refund_reversal' and amount_mdl < 0)
  );

create or replace function public.clawback_settled_order_on_refund()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  -- Cash float reversal (MoneyAudit #2): return the collected cash to the ledger
  -- so the courier's balance isn't left inflated by a refunded order. One
  -- negative movement per collecting courier, equal to what they collected for
  -- this order; idempotent (skip if already reversed for that courier).
  if new.payment_method = 'cash' then
    insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl, note)
    select m.courier_id, new.id, 'refund_reversal', -sum(m.amount_mdl), 'refund: numerar returnat clientului'
    from public.courier_cash_movements m
    where m.order_id = new.id and m.kind = 'collected'
    group by m.courier_id
    having sum(m.amount_mdl) > 0
       and not exists (
         select 1 from public.courier_cash_movements r
         where r.order_id = new.id and r.kind = 'refund_reversal' and r.courier_id = m.courier_id
       );
  end if;

  return new;
end;
$function$;
