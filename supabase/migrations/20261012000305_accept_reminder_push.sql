-- Accept reminder: the escalation that reaches an asleep kitchen tablet. The ops alert
-- (scan_ops_alerts, 3 min) goes to the admin; the restaurant got one push at arrival and
-- nothing before expire_stale_orders auto-cancels at accept_sla_minutes. Now its staff
-- get ONE more push in the last 2 minutes. Same clock as expire_stale_orders: a scheduled
-- order's clock starts 60 min before its window; catering (quote flow) is excluded.
-- Rollback: supabase/rollbacks/20261012000305_accept_reminder_push.down.sql

create or replace function public.remind_pending_restaurant_orders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int;
begin
  insert into public.notification_outbox (user_id, title, body, url, tag)
  select rs.user_id,
         '⏰ Comandă neconfirmată',
         o.order_number || ' se anulează automat în ~2 min — acceptă sau refuză acum.',
         '/restaurant/orders',
         'acceptreminder:' || o.id::text
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  join public.restaurant_staff rs on rs.restaurant_id = o.restaurant_id
  where o.status = 'pending_restaurant'
    and o.order_type = 'standard'
    and greatest(o.created_at, coalesce(o.requested_for - interval '60 minutes', o.created_at))
        < now() - make_interval(mins => greatest(r.accept_sla_minutes - 2, 0))
    -- ponytail: dedupe by tag scan; the outbox is pruned weekly, add an index on tag if it grows
    and not exists (select 1 from public.notification_outbox n where n.tag = 'acceptreminder:' || o.id::text);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

alter function public.remind_pending_restaurant_orders() set statement_timeout = '10s';
revoke all on function public.remind_pending_restaurant_orders() from public, anon, authenticated;

select cron.schedule('remind-pending-orders', '* * * * *', 'select public.remind_pending_restaurant_orders();');
