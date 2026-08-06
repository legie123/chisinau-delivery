-- ============================================================================
-- MARELE AUDIT 2026-08-03 — SecuritySectorAudit #1 (HIGH, GDPR)
--
-- kyc_documents (buletin/pasaport at onboarding) + the private kyc-documents
-- storage bucket were the ONLY sensitive PII untouched by purge_expired_pii()
-- and had no DELETE policy — identity documents stored forever. Fix: keep KYC
-- only for people who actually joined (an APPROVED application = an active
-- courier/partner, retained). For everyone else the docs are no longer needed
-- (data minimisation) and are purged with their onboarding PII:
--   - rejected applications: 90 days after review (dispute window passed);
--   - abandoned pending applications: 180 days after creation.
-- Approved applications are deliberately retained (tying approved-KYC end-of-life
-- to an offboarding flow is a separate, later change — this closes the
-- stored-forever hole for everyone NOT on the platform).
--
-- Recreated from the live 20260727002000 body (verbatim) + a KYC block. The
-- storage.allow_delete_query already set for the POD block holds for the whole
-- transaction, so the KYC storage delete is covered by the same guard.
-- ============================================================================
create or replace function public.purge_expired_pii()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
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
end;
$function$;
