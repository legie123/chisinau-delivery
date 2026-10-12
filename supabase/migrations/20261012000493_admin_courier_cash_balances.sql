-- Per-courier cash balances computed in SQL. /platform/cash summed the ledger in the app over a plain
-- select, and PostgREST caps responses (max_rows = 1000): past 1000 ledger rows the page would show
-- wrong balances and drop couriers, silently. The view groups courier_cash_movements per courier with
-- the same sum courier_cash_balance() uses; security_invoker keeps the ledger's admin-only RLS.
create or replace view public.admin_courier_cash_balances with (security_invoker = on) as
select m.courier_id,
       sum(m.amount_mdl)                                          as balance_mdl,
       coalesce(sum(m.amount_mdl) filter (where m.kind = 'collected'), 0) as collected_mdl,
       coalesce(sum(m.amount_mdl) filter (where m.kind = 'offload'), 0)   as offloaded_mdl,
       coalesce(sum(m.amount_mdl) filter (where m.kind not in ('collected', 'offload')), 0) as other_mdl,
       max(m.created_at)                                          as last_at,
       count(*)                                                   as movements
  from public.courier_cash_movements m
 group by m.courier_id;
revoke all on public.admin_courier_cash_balances from anon;
grant select on public.admin_courier_cash_balances to authenticated, viewer;
