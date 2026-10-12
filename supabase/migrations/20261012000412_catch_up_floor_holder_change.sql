-- Red-team round 2 on 7fac27b and c9e299c.
-- a) Catch-up floor: generate_weekly_payouts walked back over the whole order history; a first
--    production run would pay every delivered+paid order ever (probe: 14 payouts back to 2026-05-25,
--    4480 MDL to restaurants for orders settled outside the system). New
--    platform_settings.payouts_catchup_from (nullable); the floor is that date, else the first period
--    already in the payouts ledger, else only the previous week. generate_weekly_payouts: LIVE body
--    (20261012000408) + one delta.
-- b) A holder-name-only change on payout_accounts is recorded too (it changes who the bank pays).
--    record_payout_account_change: LIVE body (20261012000410) + one delta.
-- Rollback: re-apply both previous bodies; alter table public.platform_settings drop column payouts_catchup_from.

alter table public.platform_settings add column if not exists payouts_catchup_from date;

CREATE OR REPLACE FUNCTION public.generate_weekly_payouts(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_this_monday date := date_trunc('week', (p_now at time zone 'Europe/Chisinau')::date)::date;
  -- Catch-up floor (red-team round 2): never before payouts_catchup_from, default the first period
  -- already in the ledger; with no ledger at all, only the previous week.
  v_floor date := coalesce((select ps.payouts_catchup_from from public.platform_settings ps where ps.id),
                           (select min(p.period_start) from public.payouts p),
                           date_trunc('week', (p_now at time zone 'Europe/Chisinau')::date)::date - 7);
  v_week date;
  v_n int := 0;
begin
  for v_week in
    select distinct date_trunc('week', (o.delivered_at at time zone 'Europe/Chisinau')::date)::date
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.delivered_at is not null
      and (o.delivered_at at time zone 'Europe/Chisinau')::date < v_this_monday
      and (o.delivered_at at time zone 'Europe/Chisinau')::date >= v_floor
      and (not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant')
           or (o.courier_id is not null
               and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier')))
    order by 1
  loop
    v_n := v_n + public.generate_payouts_internal(v_week, v_week + 6);
  end loop;
  return v_n + public.generate_payouts_internal(v_this_monday - 7, v_this_monday - 1);
end; $function$;

CREATE OR REPLACE FUNCTION public.record_payout_account_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' and old.iban = new.iban and old.holder_name is not distinct from new.holder_name then return null; end if;
  insert into public.payout_account_changes (recipient_type, recipient_id, old_iban_last4, new_iban_last4, changed_by)
  values (new.recipient_type, new.recipient_id,
          case when tg_op = 'UPDATE' then right(old.iban, 4) end, right(new.iban, 4), auth.uid());
  return null;
end; $function$;
