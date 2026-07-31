-- MoneyAudit (audit adversarial 2026-07-31) — 2 findings reparate + 1 notă LOW.
--
-- CRIT: plafonul de numerar era ocolibil printr-o secvență legitimă din UI:
-- curierul apasă "Livrat, neîncasat" (p_payment_confirmed=false → zero accrual),
-- adminul rezolvă mai târziu din admin_payment_queue cu
-- admin_update_payment_status(unpaid→paid) — care doar flip-a payment_status și
-- NU scria niciodată în courier_cash_movements. Cash-ul real din buzunar nu
-- atingea niciodată ledger-ul → gate-ul de cap și auto-offline nu-l vedeau.
-- FIX: reconcilierea târzie inserează rândul 'collected' lipsă; trigger-ul
-- enforce_cash_cap_offline se declanșează automat pe insert → cap-ul se aplică
-- sincron și pe această cale.
--
-- HIGH: admin_courier_pilot_kpis (KPI #1 go/no-go, ținta 600-1000 MDL/tură)
-- însuma delivery_fee_mdl (fee-ul CLIENTULUI, înghețat la checkout) în loc de
-- coalesce(courier_fee_mdl, delivery_fee_mdl) (ce e plătit efectiv curierului) —
-- decuplat structural de tarif/așteptare/suprataxă. FIX: swap pe coloana corectă.
--
-- LOW: admin_referral_progress număra livrări 'delivered' fără filtrul paid —
-- o comandă "Livrat, neîncasat" conta la pragul de bonus. FIX: doar paid.

create or replace function public.admin_update_payment_status(p_order_id uuid, p_new_status text, p_note text default null)
returns void
language plpgsql security definer
set search_path to 'public', 'auth'
as $$
declare v_order public.orders%rowtype; v_allowed boolean;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.payment_status = p_new_status then return; end if;

  v_allowed := (v_order.payment_status, p_new_status) in (
    ('paid', 'refund_pending'),
    ('refund_pending', 'refunded'),
    ('refund_pending', 'paid'),
    ('failed', 'unpaid'),
    ('unpaid', 'paid'),
    ('pending_capture', 'paid'),    -- #6/#7: gateway confirmed out-of-band → unblock delivery
    ('pending_capture', 'failed'),  -- #6/#7: gateway abandoned/failed → customer can retry
    ('pending_capture', 'unpaid')   -- reset a stale intent
  );
  if not v_allowed then
    raise exception 'invalid payment transition % -> %', v_order.payment_status, p_new_status;
  end if;

  update public.orders set payment_status = p_new_status where id = p_order_id;

  -- MoneyAudit CRIT fix: cash reconciliat târziu tot intră în ledger → cap-ul
  -- vede TOT numerarul, indiferent pe ce cale a fost confirmat. Idempotent
  -- (un singur rând 'collected' per comandă); trigger-ul de cap se ocupă de
  -- auto-offline dacă acest insert împinge curierul la/peste plafon.
  if p_new_status = 'paid' and v_order.payment_method = 'cash'
     and v_order.status = 'delivered' and v_order.courier_id is not null
     and coalesce(v_order.total_mdl, 0) > 0
     and not exists (select 1 from public.courier_cash_movements m
                     where m.order_id = p_order_id and m.kind = 'collected') then
    insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl)
    values (v_order.courier_id, p_order_id, 'collected', v_order.total_mdl);
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
  values (p_order_id, v_order.status, 'platform_admin', auth.uid(),
          format('payment: %s -> %s%s', v_order.payment_status, p_new_status, coalesce(' — ' || p_note, '')));
end; $$;

-- KPI #1: banii curierului, nu fee-ul clientului (restul view-ului identic).
create or replace view public.admin_courier_pilot_kpis
with (security_invoker = on) as
select
  c.id as courier_id,
  c.full_name,
  c.is_active,
  (select round(avg(s.stars)::numeric, 2) from public.courier_satisfaction_surveys s
    where s.courier_id = c.id and s.week_start >= date_trunc('week', now())::date - 28) as satisfaction_avg_4w,
  (select count(*) from public.courier_satisfaction_surveys s
    where s.courier_id = c.id and s.week_start >= date_trunc('week', now())::date - 28) as satisfaction_responses_4w,
  sh.shifts_14d,
  sh.median_gross_per_shift_14d,
  sh.avg_orders_per_shift_14d,
  sh.empty_shifts_14d
from public.couriers c
left join lateral (
  select
    count(*) as shifts_14d,
    count(*) filter (where earn.orders_count = 0) as empty_shifts_14d,
    round(percentile_cont(0.5) within group (order by earn.gross_mdl)
          filter (where earn.orders_count > 0)::numeric, 2) as median_gross_per_shift_14d,
    round(avg(earn.orders_count) filter (where earn.orders_count > 0), 1) as avg_orders_per_shift_14d
  from public.courier_shifts cs
  cross join lateral (
    select
      count(o.id) as orders_count,
      coalesce(sum(coalesce(o.courier_fee_mdl, o.delivery_fee_mdl) + coalesce(o.tip_mdl, 0)), 0) as gross_mdl
    from public.orders o
    where o.courier_id = cs.courier_id and o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at >= cs.started_at and o.delivered_at < cs.ended_at
  ) earn
  where cs.courier_id = c.id and cs.ended_at is not null and cs.ended_at >= now() - interval '14 days'
) sh on true;

revoke all on public.admin_courier_pilot_kpis from anon;
grant select on public.admin_courier_pilot_kpis to authenticated;

-- Referral: doar livrări PLĂTITE contează la pragul de bonus.
create or replace view public.admin_referral_progress
with (security_invoker = on) as
select
  ref.id as referrer_id,
  ref.full_name as referrer_name,
  ref.referral_code,
  r.id as referred_id,
  r.full_name as referred_name,
  r.created_at as referred_joined_at,
  (select count(*) from public.orders o
    where o.courier_id = r.id and o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at < r.created_at + interval '30 days') as delivered_30d,
  (now() > r.created_at + interval '30 days') as window_closed,
  (select count(*) from public.orders o
    where o.courier_id = r.id and o.status = 'delivered' and o.payment_status = 'paid'
      and o.delivered_at < r.created_at + interval '30 days') >= 50 as qualified
from public.couriers r
join public.couriers ref on ref.id = r.referred_by;

revoke all on public.admin_referral_progress from anon;
grant select on public.admin_referral_progress to authenticated;
