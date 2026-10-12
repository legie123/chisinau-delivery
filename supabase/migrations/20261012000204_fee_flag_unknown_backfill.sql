-- orders.courier_fee_distance_assumed becomes three-valued, and deliveries made before the flag
-- existed are backfilled (verif-curier defect 5, 2026-10-11).
--
-- 20261012000202 added the column as NOT NULL DEFAULT false, so every order delivered before it read
-- "false", i.e. "measured", although nobody evaluated it: locally 28 of 89 delivered orders have a
-- pin missing and still read false. Now:
--   true  = at delivery the courier fee was computed on the 6.0 km assumption (a pin was missing)
--   false = at delivery the distance was measured (set by advance_delivery_status, 000202)
--   null  = not evaluated: delivered before the flag existed with both pins present today (they
--           may have been added after delivery, so "measured" cannot be claimed), or not delivered.
-- Read the flag only where status = 'delivered'. Orders that were NOT delivered when this ran keep
-- their old false (not touched on purpose: the sweeper reads updated_at on cancelled orders, and an
-- UPDATE bumps it); in-flight ones get their real value at delivery.
--
-- backfill_courier_fee_distance_assumed(cutoff) touches only DELIVERED orders delivered before the
-- cutoff, never downgrades a true (monotone), and skips rows already at their value (idempotent: a
-- second run changes 0 rows). Side effect: orders_set_updated_at bumps updated_at on the rows it
-- changes; for delivered orders that only moves their position in admin_payment_queue's sort.
-- No amount changes (courier_fee_mdl is not touched). Callable by postgres only.
alter table public.orders
  alter column courier_fee_distance_assumed drop default,
  alter column courier_fee_distance_assumed drop not null;

comment on column public.orders.courier_fee_distance_assumed is
  'Delivered orders only. true = at delivery the courier fee used the 6.0 km fallback (a pin was missing); false = measured; null = not evaluated (delivered before 2026-10-12 with both pins present now, or not delivered). The quote stamped at ready_for_pickup is a floor and can decide the paid amount: if a pin changed after ready the flag can disagree with it.';

create or replace function public.backfill_courier_fee_distance_assumed(p_delivered_before timestamptz)
returns integer
language plpgsql
set search_path = 'public'
as $$
declare
  v_changed integer;
begin
  with v as (
    select o.id,
           case when exists (select 1 from public.restaurants r
                              where r.id = o.restaurant_id and r.lat is not null and r.lng is not null)
                 and exists (select 1 from public.addresses a
                              where a.id = o.delivery_address_id and a.lat is not null and a.lng is not null)
                then null::boolean   -- both pins present today: unknown, not "measured"
                else true            -- a pin is missing: the fee can only have used the 6.0 km assumption
           end as val
    from public.orders o
    where o.status = 'delivered'
      and o.delivered_at < p_delivered_before
      and o.courier_fee_distance_assumed is not true
  )
  update public.orders o
     set courier_fee_distance_assumed = v.val
    from v
   where o.id = v.id
     and o.courier_fee_distance_assumed is distinct from v.val;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.backfill_courier_fee_distance_assumed(timestamptz) from public, anon, authenticated, service_role;

-- Everything delivered before 2026-10-12 predates the flag (000202 is not on any hosted database yet).
select public.backfill_courier_fee_distance_assumed('2026-10-12T00:00:00Z');

-- ROLLBACK (manual, in this order; restores 000202's two-valued column, keeps the backfilled trues):
--   update public.orders set courier_fee_distance_assumed = false where courier_fee_distance_assumed is null;
--   alter table public.orders alter column courier_fee_distance_assumed set default false,
--                             alter column courier_fee_distance_assumed set not null;
--   drop function public.backfill_courier_fee_distance_assumed(timestamptz);
