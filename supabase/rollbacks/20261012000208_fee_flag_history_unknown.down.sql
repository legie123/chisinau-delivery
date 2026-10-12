-- Rollback of 20261012000208: restores the 000207 backfill body. NOT reverted: the historic flags it set to null
-- (true/false read from today's pins were unproven), and the column comment (cosmetic).
CREATE OR REPLACE FUNCTION public.backfill_courier_fee_distance_assumed(p_delivered_before timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
                when exists (select 1 from public.addresses a
                              where a.id = o.delivery_address_id and a.street_address = 'Adresă ștearsă')
                then null::boolean   -- pins erased AFTER delivery (erase_customer_pii / purge_expired_pii): unknown
                else true            -- a pin is missing and was not erased: the fee used the 6.0 km assumption
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
$function$;
