-- Master-audit alignment (§6.8) — retention windows anchored to Bolt's PUBLISHED
-- table (the most specific in the industry), so we can publish a numeric policy and
-- be, on paper, ahead of all three competitors (Glovo gives only a 15-year ceiling,
-- Wolt publishes no number). Ref: Bolt privacy for couriers.
--
-- Changes vs the Wave-E cron:
--   * courier_locations GPS: 180 days → 2 YEARS (Bolt's published geolocation window).
--   * NEW: dormant customer accounts (no order in 3 years) → anonymized, while ALL
--     order rows survive for the 10-year fiscal-retention requirement (selective
--     erasure — financial records outlive personal data).
--   * address access details (intercom + notes) still redacted for customers with no
--     order in the last year.
-- (chat-message 30-day + delivery-photo 24h windows are documented in the published
--  table but there are no such tables yet — they land with those features.)

create or replace function public.purge_expired_pii()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
