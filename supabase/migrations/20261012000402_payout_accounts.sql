-- Payout IBANs: where the weekly settlement sends the money.
-- payout_accounts holds one IBAN per payee (courier or restaurant). Writes only through
-- set_payout_account (security definer): the courier for their own row, restaurant staff for their
-- restaurant, or platform_admin. Reads: the owner and admins (+ view-as parity). The IBAN is
-- normalized (no spaces, upper case) and checked by is_valid_iban (ISO 13616 mod-97, MD = 24 chars)
-- in a CHECK, so a direct insert cannot bypass it either.
-- A courier IBAN is personal data -> purge_expired_pii recreated from its LIVE body
-- (20261008000400) with one delta, block 6.

create or replace function public.is_valid_iban(p text)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare v text; v_digits text := ''; v_rem int := 0; c text; i int;
begin
  if p is null or p !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then return false; end if;
  if left(p, 2) = 'MD' and length(p) <> 24 then return false; end if;
  v := substr(p, 5) || left(p, 4);
  for i in 1..length(v) loop
    c := substr(v, i, 1);
    v_digits := v_digits || case when c ~ '[0-9]' then c else (ascii(c) - 55)::text end;
  end loop;
  for i in 1..length(v_digits) loop
    v_rem := (v_rem * 10 + substr(v_digits, i, 1)::int) % 97;
  end loop;
  return v_rem = 1;
end; $function$;

create table if not exists public.payout_accounts (
  recipient_type text        not null check (recipient_type in ('courier', 'restaurant')),
  recipient_id   uuid        not null,
  iban           text        not null check (public.is_valid_iban(iban)),
  holder_name    text        not null check (length(btrim(holder_name)) between 2 and 120),
  updated_at     timestamptz not null default now(),
  primary key (recipient_type, recipient_id)
);
alter table public.payout_accounts enable row level security;

drop policy if exists payout_accounts_read on public.payout_accounts;
create policy payout_accounts_read on public.payout_accounts
  for select to authenticated, viewer using (
    (select public.has_role('platform_admin'))
    or (recipient_type = 'courier' and recipient_id in (select id from public.couriers where user_id = (select auth.uid())))
    or (recipient_type = 'restaurant' and public.has_restaurant_access(recipient_id))
  );
-- View-as parity (20261004000100): viewer reads what authenticated reads, only while live.
drop policy if exists viewer_session_live on public.payout_accounts;
create policy viewer_session_live on public.payout_accounts
  as restrictive for select to viewer using ((select public.viewer_session_live()));
revoke all on public.payout_accounts from anon, authenticated;
grant select on public.payout_accounts to authenticated, viewer;

create or replace function public.set_payout_account(p_recipient_type text, p_recipient_id uuid, p_iban text, p_holder_name text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_iban text := upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g'));
begin
  if p_recipient_type = 'courier' then
    if not (has_role('platform_admin')
            or exists (select 1 from public.couriers where id = p_recipient_id and user_id = auth.uid())) then
      raise exception 'not authorized';
    end if;
  elsif p_recipient_type = 'restaurant' then
    if not has_restaurant_access(p_recipient_id) then raise exception 'not authorized'; end if;
  else
    raise exception 'tip de beneficiar invalid';
  end if;
  if not is_valid_iban(v_iban) then raise exception 'IBAN invalid'; end if;

  insert into public.payout_accounts (recipient_type, recipient_id, iban, holder_name)
  values (p_recipient_type, p_recipient_id, v_iban, btrim(p_holder_name))
  on conflict (recipient_type, recipient_id)
  do update set iban = excluded.iban, holder_name = excluded.holder_name, updated_at = now();
end; $function$;

revoke all on function public.set_payout_account(text, uuid, text, text) from public, anon;
grant execute on function public.set_payout_account(text, uuid, text, text) to authenticated;

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
end;
$function$;
