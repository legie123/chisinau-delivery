-- ============================================================================
-- WAVE 9b — #26 [LOW]: two admins clicking "Generează plăți" at the same instant
-- could both select the same unsettled order before either committed its ledger
-- rows, and the second commit aborted with a raw payout_orders PK unique_violation.
-- Serialize generation with a transaction-scoped advisory lock so concurrent runs
-- queue instead of racing (the second then finds everything already settled → 0).
-- Only the lock line is added; the body is otherwise identical to 20260725000500.
-- ============================================================================
create or replace function public.admin_generate_payouts(p_start date, p_end date)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
        v_payout_id uuid; v_commission numeric(10,2);
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  perform pg_advisory_xact_lock(hashtext('admin_generate_payouts'));  -- #26: serialize concurrent runs
  select * into v_settings from public.platform_settings where id;

  for v_c in
    select o.restaurant_id as rid, count(*) as cnt,
           sum(case when o.order_type = 'standard' then o.subtotal_mdl
                    else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as gross
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and o.delivered_at::date <= p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant')
    group by o.restaurant_id
  loop
    v_commission := round(v_c.gross * v_settings.restaurant_commission_pct / 100, 2);
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('restaurant', v_c.rid, p_start, p_end, v_c.cnt, v_c.gross, v_commission, v_c.gross - v_commission)
    returning id into v_payout_id;
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'restaurant', g.gross, g.gross - round(g.gross * v_settings.restaurant_commission_pct / 100, 2)
    from public.orders o
    cross join lateral (select (case when o.order_type = 'standard' then o.subtotal_mdl
                          else greatest(o.total_mdl - o.delivery_fee_mdl - coalesce(o.tip_mdl, 0), 0) end) as gross) g
    where o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at is not null and o.delivered_at::date <= p_end
      and o.restaurant_id = v_c.rid
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'restaurant');
    v_n := v_n + 1;
  end loop;

  for v_c in
    select o.courier_id as cid, count(*) as cnt,
           sum(o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)) as gross,
           sum(o.delivery_fee_mdl) as fees
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id is not null
      and o.delivered_at is not null and o.delivered_at::date <= p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier')
    group by o.courier_id
  loop
    v_commission := round(v_c.fees * v_settings.courier_commission_pct / 100, 2);
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('courier', v_c.cid, p_start, p_end, v_c.cnt, v_c.gross, v_commission, v_c.gross - v_commission)
    returning id into v_payout_id;
    insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
    select v_payout_id, o.id, 'courier', o.delivery_fee_mdl + coalesce(o.tip_mdl, 0),
           (o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)) - round(o.delivery_fee_mdl * v_settings.courier_commission_pct / 100, 2)
    from public.orders o
    where o.status = 'delivered' and o.payment_status = 'paid' and o.courier_id = v_c.cid
      and o.delivered_at is not null and o.delivered_at::date <= p_end
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id and po.recipient_type = 'courier');
    v_n := v_n + 1;
  end loop;

  return v_n;
end; $$;
revoke execute on function public.admin_generate_payouts(date, date) from public, anon, authenticated;
grant execute on function public.admin_generate_payouts(date, date) to authenticated;
