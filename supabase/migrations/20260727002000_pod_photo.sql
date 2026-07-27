-- Directive 12 (web pilot only, mobile excluded) — PROOF OF DELIVERY PHOTO
-- for cash orders. SOFT EVIDENCE ONLY: never a gate on advance_delivery_status
-- (the audit is explicit — no geofence/photo as delivery proof-gate), purely a
-- courier-initiated, optional artifact for dispute resolution.
--
-- Storage: new PRIVATE bucket 'delivery-proof', path-scoped {order_id}/... —
-- mirrors 20260708000600_storage_buckets's {restaurantId}/... convention, but
-- authorization here reads the ORDERS table (not a static role check) since
-- "the assigned courier for this order" is a per-row fact, not a role. Only
-- INSERT (assigned courier) + SELECT (order's customer + admin) policies exist
-- below — deliberately NO update/delete policy at all, so the bucket is
-- append-only by RLS default-deny, same spirit as courier_cash_movements /
-- geofence_events' append-only guards (there RLS is backed by a trigger too,
-- because those are plain tables; storage.objects is Supabase-managed, so the
-- absence of any matching update/delete policy IS the enforcement here).
insert into storage.buckets (id, name, public)
values ('delivery-proof', 'delivery-proof', false)
on conflict (id) do nothing;

create policy "delivery_proof_courier_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'delivery-proof'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(name))[1])::uuid
        and o.courier_id = public.current_courier_id()
    )
  );

create policy "delivery_proof_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'delivery-proof'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(name))[1])::uuid
        and (o.customer_id = (select auth.uid()) or has_role('platform_admin'))
    )
  );

-- orders.pod_photo_path — nullable, set exclusively via attach_delivery_proof
-- below (client never writes orders directly, per the repo's one invariant).
alter table public.orders add column pod_photo_path text;

-- attach_delivery_proof — the assigned courier only. Valid while the order is
-- en_route (photo taken in the field, before the "delivered" tap) or delivered
-- (photo taken right at hand-off, after the tap) — idempotent-overwrite is
-- allowed within 1h of delivered_at (a courier retaking a bad shot), closed
-- after that so a "fix" long after the fact can't masquerade as contemporaneous
-- evidence. NEVER required to complete delivery: advance_delivery_status is
-- completely untouched by this migration, does not read pod_photo_path, and
-- has no dependency on this function whatsoever.
create or replace function public.attach_delivery_proof(p_order_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_order public.orders%rowtype;
  v_courier_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  v_courier_id := public.current_courier_id();
  if v_courier_id is null or v_order.courier_id is distinct from v_courier_id then
    raise exception 'not authorized';
  end if;

  if v_order.status not in ('en_route', 'delivered') then
    raise exception 'delivery proof can only be attached while en route or after delivery (status=%)', v_order.status;
  end if;

  if v_order.status = 'delivered' and v_order.delivered_at is not null
     and now() - v_order.delivered_at > interval '1 hour' then
    raise exception 'delivery proof window has closed (more than 1h since delivered)';
  end if;

  -- Path must live under this order's own storage folder — matches the
  -- storage RLS convention (first path segment = order_id) so a courier can
  -- never point an order at a photo object stored under a different order.
  if p_path is null or p_path !~ ('^' || p_order_id::text || '/') then
    raise exception 'invalid proof path';
  end if;

  update public.orders set pod_photo_path = p_path where id = p_order_id;
end;
$function$;

revoke all on function public.attach_delivery_proof(uuid, text) from public, anon;
grant execute on function public.attach_delivery_proof(uuid, text) to authenticated;

-- GDPR: 90-day purge of delivery-proof photos (a photo of a person's doorstep/
-- hand-off is personal data, but a much shorter, more specific class than the
-- 2-year GPS-precision retention above — 90 days is ample for a cash dispute
-- to surface and be resolved). Recreated VERBATIM from the CURRENT DB body
-- (20260727001200_geofence_events.sql) with only the new step 0b inserted,
-- per the phoenix-review pattern this repo already uses for purge_expired_pii.
-- Re-applies the statement_timeout hardening from 20260727001700 — CREATE OR
-- REPLACE FUNCTION does NOT retain a prior ALTER FUNCTION ... SET unless it is
-- restated, so skipping this line would silently regress that fix.
create or replace function public.purge_expired_pii()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0. Geofence hint events (precise GPS, same retention class as courier
  --    GPS below) — 2 years.
  delete from public.geofence_events where created_at < now() - interval '2 years';

  -- 0b. Delivery-proof (POD) photos — 90 days. Storage object first, then null
  --     out any orders.pod_photo_path that no longer has a backing object (so
  --     the admin/customer signed-URL path never dangles against a deleted file).
  --     storage.objects carries a protect_delete() trigger that raises on any
  --     direct SQL DELETE unless storage.allow_delete_query is set — this is
  --     the Storage API's own safety net against accidental object-table
  --     deletes, and applies to this SECURITY DEFINER function exactly like
  --     any other session. set_config(..., true) scopes it to this
  --     transaction only (this function's single-statement cron invocation).
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'delivery-proof' and created_at < now() - interval '90 days';
  update public.orders o set pod_photo_path = null
  where o.pod_photo_path is not null
    and not exists (
      select 1 from storage.objects s where s.bucket_id = 'delivery-proof' and s.name = o.pod_photo_path
    );

  -- 1. Courier GPS last-known position — 2 years (Bolt's published window).
  delete from public.courier_locations where updated_at < now() - interval '2 years';

  -- 2. Address access details (intercom code + free-text notes) — redact for
  --    customers with no order in the last year.
  update public.addresses a
    set intercom_code = null, notes = null
  where (a.intercom_code is not null or a.notes is not null)
    and not exists (
      select 1 from public.orders o
      where o.customer_id = a.customer_id and o.created_at > now() - interval '365 days'
    );

  -- 3. Dormant customer accounts — had orders, but none in 3 years → anonymize the
  --    personal data. Order/rating/payout rows are PRESERVED (10-year fiscal
  --    retention); only name/phone/address are scrubbed.
  update public.profiles p
    set full_name = 'Utilizator șters', phone = null
  where p.role = 'customer'
    and exists (select 1 from public.orders o where o.customer_id = p.id)
    and not exists (
      select 1 from public.orders o
      where o.customer_id = p.id and o.created_at > now() - interval '3 years'
    );

  update public.addresses a
    set street_address = 'Adresă ștearsă', label = null, sector = null, building = null,
        apartment = null, entrance = null, floor = null, intercom_code = null, notes = null,
        lat = null, lng = null
  where a.customer_id in (
    select p.id from public.profiles p
    where p.role = 'customer'
      and exists (select 1 from public.orders o where o.customer_id = p.id)
      and not exists (
        select 1 from public.orders o
        where o.customer_id = p.id and o.created_at > now() - interval '3 years'
      )
  );

  -- Old customer order notes may carry personal instructions — scrub past 3 years.
  update public.orders set notes = null
  where notes is not null and created_at < now() - interval '3 years';
end;
$$;

revoke execute on function public.purge_expired_pii() from public, anon, authenticated;
alter function public.purge_expired_pii() set statement_timeout = '30s';
