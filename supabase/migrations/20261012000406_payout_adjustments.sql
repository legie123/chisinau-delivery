-- Case-by-case compensation (owner decision 2026-10-12): an admin attaches a signed amount and a
-- reason to a complaint, for that order's restaurant or courier (payee taken from the order, never
-- from the caller; |amount| <= order total; one per complaint and payee type). Positive = we pay the
-- payee more (e.g. food cooked for an order we cancelled), negative = deduction.
-- The next payout run picks up every unattached adjustment: added to the payee's payout created in
-- that run, or a 0-order payout of its own. Attached once (payout_id), so reruns never double it.
-- generate_payouts_internal recreated from its LIVE body (20261012000401) with ONE delta: the
-- adjustments phase before the final return. Same advisory lock, so admin + cron cannot race.
-- ponytail: an adjustment joins whatever run comes next, even a manual run for an older week.

create table if not exists public.payout_adjustments (
  id             uuid          primary key default gen_random_uuid(),
  recipient_type text          not null check (recipient_type in ('courier', 'restaurant')),
  recipient_id   uuid          not null,
  amount_mdl     numeric(10,2) not null check (amount_mdl <> 0),
  reason         text          not null check (length(btrim(reason)) between 3 and 500),
  complaint_id   uuid          references public.order_complaints(id) on delete restrict,
  order_id       uuid          references public.orders(id) on delete restrict,
  payout_id      uuid          references public.payouts(id) on delete restrict,
  created_by     uuid          default auth.uid(),
  created_at     timestamptz   not null default now()
);
create unique index if not exists payout_adjustments_one_per_complaint
  on public.payout_adjustments (complaint_id, recipient_type) where complaint_id is not null;
create index if not exists payout_adjustments_unattached
  on public.payout_adjustments (recipient_type, recipient_id) where payout_id is null;
alter table public.payout_adjustments enable row level security;

drop policy if exists payout_adjustments_admin_read on public.payout_adjustments;
create policy payout_adjustments_admin_read on public.payout_adjustments
  for select to authenticated, viewer using ((select public.has_role('platform_admin')));
drop policy if exists viewer_session_live on public.payout_adjustments;
create policy viewer_session_live on public.payout_adjustments
  as restrictive for select to viewer using ((select public.viewer_session_live()));
revoke all on public.payout_adjustments from anon, authenticated;
grant select on public.payout_adjustments to authenticated, viewer;

create or replace function public.admin_add_payout_adjustment(p_complaint_id uuid, p_recipient_type text,
                                                              p_amount_mdl numeric, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_order public.orders%rowtype; v_recipient uuid; v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select o.* into v_order from public.order_complaints c join public.orders o on o.id = c.order_id
   where c.id = p_complaint_id;
  if not found then raise exception 'Reclamația nu există.'; end if;
  v_recipient := case p_recipient_type when 'restaurant' then v_order.restaurant_id
                                       when 'courier' then v_order.courier_id end;
  if v_recipient is null then raise exception 'Comanda nu are acest beneficiar.'; end if;
  if coalesce(p_amount_mdl, 0) = 0 or abs(p_amount_mdl) > v_order.total_mdl then
    raise exception 'Suma trebuie să fie nenulă și cel mult totalul comenzii (% MDL).', v_order.total_mdl;
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Scrie motivul ajustării.'; end if;

  insert into public.payout_adjustments (recipient_type, recipient_id, amount_mdl, reason, complaint_id, order_id, created_by)
  values (p_recipient_type, v_recipient, round(p_amount_mdl, 2), btrim(p_reason), p_complaint_id, v_order.id, auth.uid())
  returning id into v_id;
  return v_id;
end; $function$;

revoke all on function public.admin_add_payout_adjustment(uuid, text, numeric, text) from public, anon;
grant execute on function public.admin_add_payout_adjustment(uuid, text, numeric, text) to authenticated;

CREATE OR REPLACE FUNCTION public.generate_payouts_internal(p_start date, p_end date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
        v_payout_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('admin_generate_payouts'));
  -- kept ONLY as the coalesce fallback below (never hit with the seeded v1 config).
  select * into v_settings from public.platform_settings where id;

  -- ---- restaurants ----
  for v_c in
    select o.restaurant_id as rid, count(*) as cnt, sum(b.gross) as gross, sum(b.commission) as commission
    from public.orders o
    left join lateral public.pricing_config_at(o.delivered_at) pc on true
    cross join lateral (
      select gg as gross,
             round(gg * coalesce(pc.restaurant_commission_pct, v_settings.restaurant_commission_pct) / 100, 2) as commission
      from (select case when o.order_type = 'standard' then o.subtotal_mdl
                        else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as x(gg)
    ) b
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and (o.delivered_at at time zone 'Europe/Chisinau')::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant')
    group by o.restaurant_id
  loop
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('restaurant', v_c.rid, p_start, p_end, v_c.cnt, v_c.gross, v_c.commission, v_c.gross - v_c.commission)
    returning id into v_payout_id;

    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'restaurant', b.gross, b.gross - b.commission
    from public.orders o
    left join lateral public.pricing_config_at(o.delivered_at) pc on true
    cross join lateral (
      select gg as gross,
             round(gg * coalesce(pc.restaurant_commission_pct, v_settings.restaurant_commission_pct) / 100, 2) as commission
      from (select case when o.order_type = 'standard' then o.subtotal_mdl
                        else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as x(gg)
    ) b
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and (o.delivered_at at time zone 'Europe/Chisinau')::date between p_start and p_end
      and o.restaurant_id = v_c.rid
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant');
    v_n := v_n + 1;
  end loop;

  -- ---- couriers (commission on the fee only, tip passed through) ----
  for v_c in
    select o.courier_id as cid, count(*) as cnt,
           sum(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0)) as gross,
           sum(round(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) * coalesce(pc.courier_commission_pct, v_settings.courier_commission_pct) / 100, 2)) as commission
    from public.orders o
    left join lateral public.pricing_config_at(o.delivered_at) pc on true
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id is not null
      and o.delivered_at is not null and (o.delivered_at at time zone 'Europe/Chisinau')::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier')
    group by o.courier_id
  loop
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('courier', v_c.cid, p_start, p_end, v_c.cnt, v_c.gross, v_c.commission, v_c.gross - v_c.commission)
    returning id into v_payout_id;

    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'courier',
           coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0),
           (coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0))
             - round(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) * coalesce(pc.courier_commission_pct, v_settings.courier_commission_pct) / 100, 2)
    from public.orders o
    left join lateral public.pricing_config_at(o.delivered_at) pc on true
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id = v_c.cid
      and o.delivered_at is not null and (o.delivered_at at time zone 'Europe/Chisinau')::date between p_start and p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier');
    v_n := v_n + 1;
  end loop;

  -- ---- manual adjustments (case-by-case compensation), each attached to exactly one payout ----
  for v_c in
    select a.recipient_type as rtype, a.recipient_id as rid, sum(a.amount_mdl) as amount
    from public.payout_adjustments a
    where a.payout_id is null
    group by a.recipient_type, a.recipient_id
  loop
    select p.id into v_payout_id from public.payouts p
     where p.recipient_type = v_c.rtype and p.recipient_id = v_c.rid
       and p.period_start = p_start and p.period_end = p_end and p.status = 'pending'
     order by p.created_at desc limit 1;
    if v_payout_id is null then
      insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
      values (v_c.rtype, v_c.rid, p_start, p_end, 0, 0, 0, v_c.amount)
      returning id into v_payout_id;
      v_n := v_n + 1;
    else
      update public.payouts set net_mdl = net_mdl + v_c.amount where id = v_payout_id;
    end if;
    update public.payout_adjustments set payout_id = v_payout_id
     where recipient_type = v_c.rtype and recipient_id = v_c.rid and payout_id is null;
  end loop;

  return v_n;
end; $function$;
