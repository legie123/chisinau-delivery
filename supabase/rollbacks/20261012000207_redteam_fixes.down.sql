-- Rollback of 20261012000207_redteam_fixes. Restores the previous function bodies, the (order_id, kind) unique,
-- the storage policy without a window and the bucket without limits. NOT reverted: the flags the migration repaired
-- from true to null (erased addresses) — which ones they were is not recorded, and true was wrong for them.
-- Fails if two reports now share (order_id, kind) (possible after the fix): delete the newer duplicate by hand first.
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

  insert into public.delivery_issue_reports (order_id, courier_id, kind, order_status)
  values (p_order_id, v_courier, p_kind, v_order.status)
  on conflict (order_id, kind) do nothing
  returning id into v_new;
  return v_new is not null; -- false = already reported (idempotent retry)
end;
$function$;
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
$function$;
alter table public.delivery_issue_reports
  drop constraint delivery_issue_reports_order_courier_kind_leg_key,
  drop constraint delivery_issue_reports_leg_check,
  add constraint delivery_issue_reports_order_id_kind_key unique (order_id, kind);
alter table public.delivery_issue_reports drop column leg;
drop policy delivery_proof_courier_write on storage.objects;
create policy delivery_proof_courier_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'delivery-proof'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(objects.name))[1])::uuid
        and o.courier_id = public.current_courier_id()
    )
  );
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'delivery-proof';
