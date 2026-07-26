-- Wave E — GDPR retention + right-to-erasure. The pilot handles real addresses,
-- intercom codes and courier GPS; before this there was zero retention or erasure
-- machinery. Two mechanisms, both order-integrity-safe (rows stay, FKs intact —
-- only sensitive fields are cleared).

-- E1 — Scheduled retention purge. Runs daily via pg_cron.
--   * Courier GPS: a courier_locations row is the last-known position (one per
--     courier, upserted). One not refreshed in 180 days belongs to someone who
--     left the platform — no reason to keep a precise pin. Delete it.
--   * Address access details: the highest-sensitivity fields (intercom code +
--     free-text notes) are redacted on saved addresses whose customer has placed
--     NO order in the last 365 days (retention window elapsed for an inactive
--     customer). Street/sector stay so historical orders still show a locality.
create or replace function public.purge_expired_pii()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.courier_locations where updated_at < now() - interval '180 days';

  update public.addresses a
    set intercom_code = null, notes = null
  where (a.intercom_code is not null or a.notes is not null)
    and not exists (
      select 1 from public.orders o
      where o.customer_id = a.customer_id
        and o.created_at > now() - interval '365 days'
    );
end;
$$;

revoke execute on function public.purge_expired_pii() from public, anon, authenticated;

-- E2 — Right to erasure. A platform_admin (processing a verified request) or the
-- customer themselves anonymizes the customer's PII on demand. Order/rating rows
-- are preserved for financial + dispute integrity; only the personal data is
-- scrubbed. full_name is NOT NULL, so it becomes a tombstone label.
create or replace function public.erase_customer_pii(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (has_role('platform_admin') or p_customer_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  update public.profiles
    set full_name = 'Utilizator șters', phone = null
  where id = p_customer_id;

  update public.addresses
    set label = null, street_address = 'Adresă ștearsă', sector = null, building = null,
        apartment = null, entrance = null, floor = null, intercom_code = null, notes = null,
        lat = null, lng = null
  where customer_id = p_customer_id;

  update public.orders set notes = null where customer_id = p_customer_id and notes is not null;
end;
$$;

revoke execute on function public.erase_customer_pii(uuid) from public, anon;
grant execute on function public.erase_customer_pii(uuid) to authenticated;

-- Daily at 03:15 (Chișinău is UTC+2/+3; the exact minute is not load-bearing).
select cron.schedule('purge-expired-pii', '15 3 * * *', $$select public.purge_expired_pii();$$);
