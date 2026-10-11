-- Pilot support log: complaints on an order, logged and resolved by ops (platform_admin).
-- One OPEN complaint per order (partial unique index); resolving needs a written resolution and
-- records who and when. Admin-only: RLS read for platform_admin (+ view-as parity), writes only via
-- admin_open_complaint / admin_resolve_complaint. No money moves here: compensation policy is not
-- ratified yet; a full refund still goes through admin_update_payment_status (+ clawback trigger).
-- Notes/resolutions carry personal data -> purge_expired_pii recreated from its LIVE body
-- (20261012000402) with one delta, block 7: text scrubbed after 3 years, the row kept for stats.

create table if not exists public.order_complaints (
  id          uuid        primary key default gen_random_uuid(),
  order_id    uuid        not null references public.orders(id) on delete cascade,
  kind        text        not null check (kind in ('missing_item', 'wrong_item', 'late', 'quality', 'courier', 'other')),
  note        text        not null check (length(btrim(note)) between 3 and 1000),
  status      text        not null default 'open' check (status in ('open', 'resolved')),
  resolution  text        check (resolution is null or length(btrim(resolution)) between 3 and 1000),
  created_by  uuid        default auth.uid(),
  created_at  timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  check ((status = 'open') = (resolved_at is null))
);
create unique index if not exists order_complaints_one_open on public.order_complaints (order_id) where status = 'open';
create index if not exists order_complaints_order on public.order_complaints (order_id, created_at desc);
alter table public.order_complaints enable row level security;

drop policy if exists order_complaints_admin_read on public.order_complaints;
create policy order_complaints_admin_read on public.order_complaints
  for select to authenticated, viewer using ((select public.has_role('platform_admin')));
drop policy if exists viewer_session_live on public.order_complaints;
create policy viewer_session_live on public.order_complaints
  as restrictive for select to viewer using ((select public.viewer_session_live()));
revoke all on public.order_complaints from anon, authenticated;
grant select on public.order_complaints to authenticated, viewer;

create or replace function public.admin_open_complaint(p_order_id uuid, p_kind text, p_note text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.orders where id = p_order_id) then raise exception 'order not found'; end if;
  if exists (select 1 from public.order_complaints where order_id = p_order_id and status = 'open') then
    raise exception 'Comanda are deja o reclamație deschisă.';
  end if;
  insert into public.order_complaints (order_id, kind, note, created_by)
  values (p_order_id, p_kind, btrim(p_note), auth.uid())
  returning id into v_id;
  return v_id;
end; $function$;

create or replace function public.admin_resolve_complaint(p_complaint_id uuid, p_resolution text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_resolution, ''))) < 3 then raise exception 'Scrie cum a fost rezolvată reclamația.'; end if;
  update public.order_complaints
     set status = 'resolved', resolution = btrim(p_resolution), resolved_by = auth.uid(), resolved_at = now()
   where id = p_complaint_id and status = 'open';
  if not found then raise exception 'Reclamația nu există sau e deja rezolvată.'; end if;
end; $function$;

revoke all on function public.admin_open_complaint(uuid, text, text) from public, anon;
revoke all on function public.admin_resolve_complaint(uuid, text) from public, anon;
grant execute on function public.admin_open_complaint(uuid, text, text) to authenticated;
grant execute on function public.admin_resolve_complaint(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.purge_expired_pii()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
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

  -- 4. KYC identity documents (buletin/pasaport) — the most sensitive PII in the
  --    schema. Retained ONLY while the person is on the platform (approved
  --    application). For rejected (90d after review) and abandoned pending (180d
  --    after creation) applications the docs are purged: storage object first
  --    (same allow_delete_query guard set above), then the kyc_documents row,
  --    then the application's own PII is scrubbed (status + timestamps kept for
  --    audit). Approved applications are deliberately untouched here.
  delete from storage.objects
  where bucket_id = 'kyc-documents'
    and name in (
      select k.storage_path from public.kyc_documents k
      join public.onboarding_applications a on a.id = k.application_id
      where (a.status = 'rejected' and coalesce(a.reviewed_at, a.created_at) < now() - interval '90 days')
         or (a.status = 'pending'  and a.created_at < now() - interval '180 days')
    );

  delete from public.kyc_documents k
  using public.onboarding_applications a
  where a.id = k.application_id
    and ((a.status = 'rejected' and coalesce(a.reviewed_at, a.created_at) < now() - interval '90 days')
      or (a.status = 'pending'  and a.created_at < now() - interval '180 days'));

  update public.onboarding_applications a
    set full_name = 'Solicitant șters', phone = '', email = null, details = '{}'::jsonb
  where (a.status = 'rejected' and coalesce(a.reviewed_at, a.created_at) < now() - interval '90 days')
     or (a.status = 'pending'  and a.created_at < now() - interval '180 days');

  -- 5. View-as audit (admin-written reason + who looked at whom) — 365 days.
  delete from public.view_as_sessions where started_at < now() - interval '365 days';

  -- 6. Courier payout IBANs (personal bank data) - kept while the courier works; dropped once
  --    the account is 3+ years old, the courier delivered nothing in 3 years and nothing is
  --    still pending payment. Restaurant IBANs are company data, not purged.
  delete from public.payout_accounts pa
  where pa.recipient_type = 'courier'
    and pa.updated_at < now() - interval '3 years'
    and not exists (select 1 from public.orders o
                    where o.courier_id = pa.recipient_id and o.delivered_at > now() - interval '3 years')
    and not exists (select 1 from public.payouts p
                    where p.recipient_type = 'courier' and p.recipient_id = pa.recipient_id and p.status = 'pending');

  -- 7. Support complaints - the note and resolution quote customers; scrubbed after 3 years,
  --    the row (kind, dates, status) stays for support statistics.
  update public.order_complaints
     set note = '[șters]', resolution = case when resolution is null then null else '[șters]' end
   where created_at < now() - interval '3 years' and note <> '[șters]';
end;
$function$;
