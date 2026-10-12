-- Red-team fixes (verif-curier round 2 + verif-curier-g4, 2026-10-12). No amount changes.
--
-- 1. delivery_issue_reports was unique on (order_id, kind): after admin_reassign_courier the new courier's
--    report of the same kind was swallowed (the app told them "you already reported this"), and a second
--    "running late" on the delivery leg was swallowed too. Now one row per (order, courier, kind, leg), leg =
--    pickup (courier_assigned) / delivery (picked_up, en_route). courier_report_issue recreated from its live
--    body, one delta (the insert). The table is append-only and was empty locally.
-- 2. backfill_courier_fee_distance_assumed read "a pin is missing today" as "6.0 km at delivery", but
--    erase_customer_pii / purge_expired_pii null the pins AFTER delivery (marker street_address =
--    'Adresă ștearsă'), so measured fees got flagged. Erased addresses now count as unknown (null); rows the
--    first backfill already flagged that way are repaired below. Recreated from the live body, one delta.
-- 3. delivery-proof uploads were allowed in any status (attach_delivery_proof refused them, leaving orphan
--    objects): the storage insert policy now has the same window as the RPC (en_route, or <= 1 h after
--    delivery). The bucket gets a 10 MiB cap and image MIME types only (it had neither).
-- ROLLBACK: supabase/rollbacks/20261012000207_redteam_fixes.down.sql

-- 1. issue reports per (order, courier, kind, leg)
alter table public.delivery_issue_reports add column leg text;
update public.delivery_issue_reports set leg = case when order_status = 'courier_assigned' then 'pickup' else 'delivery' end;
alter table public.delivery_issue_reports
  alter column leg set not null,
  add constraint delivery_issue_reports_leg_check check (leg in ('pickup', 'delivery')),
  drop constraint delivery_issue_reports_order_id_kind_key,
  add constraint delivery_issue_reports_order_courier_kind_leg_key unique (order_id, courier_id, kind, leg);

CREATE OR REPLACE FUNCTION public.courier_report_issue(p_order_id uuid, p_kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_courier uuid;
  v_order public.orders%rowtype;
  v_new uuid;
begin
  select id into v_courier from public.couriers where user_id = auth.uid() and is_active;
  if v_courier is null then raise exception 'Doar un curier activ poate raporta o problemă.'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.courier_id is distinct from v_courier then
    raise exception 'Comanda nu îți este atribuită.';
  end if;
  if v_order.status not in ('courier_assigned', 'picked_up', 'en_route') then
    raise exception 'Comanda nu mai este activă.';
  end if;

  if p_kind not in ('running_late', 'restaurant_delayed', 'venue_not_found', 'customer_unreachable', 'address_wrong') then
    raise exception 'Tip de problemă necunoscut.';
  end if;
  if p_kind in ('restaurant_delayed', 'venue_not_found') and v_order.status <> 'courier_assigned' then
    raise exception 'Problemele cu restaurantul se raportează înainte de ridicare.';
  end if;
  if p_kind in ('customer_unreachable', 'address_wrong') and v_order.status = 'courier_assigned' then
    raise exception 'Problemele cu clientul se raportează după ridicare.';
  end if;

  insert into public.delivery_issue_reports (order_id, courier_id, kind, order_status, leg)
  values (p_order_id, v_courier, p_kind, v_order.status,
          case when v_order.status = 'courier_assigned' then 'pickup' else 'delivery' end)
  on conflict (order_id, courier_id, kind, leg) do nothing
  returning id into v_new;
  return v_new is not null; -- false = already reported (idempotent retry)
end;
$function$;

-- 2. erased pins are unknown, not assumed
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

update public.orders o
   set courier_fee_distance_assumed = null
 where o.status = 'delivered'
   and o.delivered_at < '2026-10-12T00:00:00Z'
   and o.courier_fee_distance_assumed is true
   and exists (select 1 from public.addresses a where a.id = o.delivery_address_id and a.street_address = 'Adresă ștearsă')
   and exists (select 1 from public.restaurants r where r.id = o.restaurant_id and r.lat is not null and r.lng is not null);

-- 3. proof uploads only inside attach_delivery_proof's window; bucket limits
drop policy delivery_proof_courier_write on storage.objects;
create policy delivery_proof_courier_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'delivery-proof'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(objects.name))[1])::uuid
        and o.courier_id = public.current_courier_id()
        and (o.status = 'en_route'
             or (o.status = 'delivered' and o.delivered_at > now() - interval '1 hour'))
    )
  );
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'delivery-proof';
