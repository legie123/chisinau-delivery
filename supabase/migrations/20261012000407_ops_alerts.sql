-- Ops alerts with a mechanism (W5). scan_ops_alerts() runs on pg_cron every minute and raises ONE
-- alert per (kind, ref_id):
--   restaurant_not_accepting — pending_restaurant longer than platform_settings.restaurant_accept_alert_minutes
--                              (default 3): ops phones the restaurant before the accept SLA cancels it;
--   dispatch_error           — a dispatch_errors row (the sweeper could not dispatch the order);
--   push_stuck               — a notification_outbox row unsent for 5+ minutes.
-- If app.ops_alert_webhook_url is set (ALTER DATABASE ... SET, channel chosen by the owner), every
-- new alert is POSTed once via pg_net as {"text": ..., "content": ...} (Slack- and Discord-shaped)
-- and stamped notified_at. Without it, alerts still show in the panel. Admin-only read + ack.
-- ponytail: one alert per ref forever; a re-occurrence after ack on the same order is not re-raised.
-- Rollback: select cron.unschedule('scan-ops-alerts'); drop function public.scan_ops_alerts();
--   drop function public.admin_ack_ops_alert(uuid); drop table public.ops_alerts;
--   alter table public.platform_settings drop column restaurant_accept_alert_minutes;

alter table public.platform_settings
  add column if not exists restaurant_accept_alert_minutes integer not null default 3
  check (restaurant_accept_alert_minutes between 1 and 30);

create table if not exists public.ops_alerts (
  id          uuid        primary key default gen_random_uuid(),
  kind        text        not null check (kind in ('restaurant_not_accepting', 'dispatch_error', 'push_stuck')),
  ref_id      uuid        not null,
  message     text        not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  acked_at    timestamptz,
  acked_by    uuid,
  unique (kind, ref_id)
);
create index if not exists ops_alerts_open on public.ops_alerts (created_at desc) where acked_at is null;
alter table public.ops_alerts enable row level security;

drop policy if exists ops_alerts_admin_read on public.ops_alerts;
create policy ops_alerts_admin_read on public.ops_alerts
  for select to authenticated, viewer using ((select public.has_role('platform_admin')));
drop policy if exists viewer_session_live on public.ops_alerts;
create policy viewer_session_live on public.ops_alerts
  as restrictive for select to viewer using ((select public.viewer_session_live()));
revoke all on public.ops_alerts from anon, authenticated;
grant select on public.ops_alerts to authenticated, viewer;

create or replace function public.scan_ops_alerts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_new int := 0; v_n int; v_url text := nullif(current_setting('app.ops_alert_webhook_url', true), ''); a record;
begin
  insert into public.ops_alerts (kind, ref_id, message)
  select 'restaurant_not_accepting', o.id,
         format('Comanda %s așteaptă acceptarea de %s min la %s — sună restaurantul.',
                o.order_number, floor(extract(epoch from now() - o.created_at) / 60)::int, r.name)
  from public.orders o join public.restaurants r on r.id = o.restaurant_id
  where o.status = 'pending_restaurant' and o.order_type = 'standard'
    and greatest(o.created_at, coalesce(o.requested_for - interval '60 minutes', o.created_at))
        < now() - make_interval(mins => (select ps.restaurant_accept_alert_minutes from public.platform_settings ps where ps.id))
  on conflict (kind, ref_id) do nothing;
  get diagnostics v_n = row_count; v_new := v_new + v_n;

  insert into public.ops_alerts (kind, ref_id, message)
  select 'dispatch_error', e.order_id,
         format('Dispecerizarea comenzii %s eșuează: %s', o.order_number, e.message)
  from public.dispatch_errors e join public.orders o on o.id = e.order_id
  where o.status = 'ready_for_pickup'
  on conflict (kind, ref_id) do nothing;
  get diagnostics v_n = row_count; v_new := v_new + v_n;

  insert into public.ops_alerts (kind, ref_id, message)
  select 'push_stuck', n.id, format('Notificarea „%s” nu a plecat de %s min (încercări: %s).',
                                    n.title, floor(extract(epoch from now() - n.created_at) / 60)::int, n.attempts)
  from public.notification_outbox n
  where n.sent_at is null and n.created_at < now() - interval '5 minutes'
  on conflict (kind, ref_id) do nothing;
  get diagnostics v_n = row_count; v_new := v_new + v_n;

  if v_url is not null then
    for a in select id, message from public.ops_alerts where notified_at is null and acked_at is null order by created_at limit 50 loop
      perform net.http_post(url := v_url,
                            headers := jsonb_build_object('Content-Type', 'application/json'),
                            body := jsonb_build_object('text', a.message, 'content', a.message));
      update public.ops_alerts set notified_at = now() where id = a.id;
    end loop;
  end if;
  return v_new;
end; $function$;

revoke all on function public.scan_ops_alerts() from public, anon, authenticated;
alter function public.scan_ops_alerts() set statement_timeout = '30s';

create or replace function public.admin_ack_ops_alert(p_alert_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  update public.ops_alerts set acked_at = now(), acked_by = auth.uid() where id = p_alert_id and acked_at is null;
  if not found then raise exception 'Alerta nu există sau e deja confirmată.'; end if;
end; $function$;

revoke all on function public.admin_ack_ops_alert(uuid) from public, anon;
grant execute on function public.admin_ack_ops_alert(uuid) to authenticated;

select cron.schedule('scan-ops-alerts', '* * * * *', 'select public.scan_ops_alerts();');
