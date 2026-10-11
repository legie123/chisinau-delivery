-- A ready order nobody picks up is cancelled after platform_settings.no_courier_cancel_minutes
-- (default 30, owner decision 2026-10-12) instead of a hardcoded 6 hours. The customer push already
-- fires: the cancelled status event goes through enqueue_customer_status_push. The restaurant is
-- compensated case by case from the complaint log (owner decision), not automatically here.
-- expire_stale_orders recreated from its LIVE body (20260812000000 lineage) with ONE delta: the
-- 6-hour interval. Its SET statement_timeout clause is part of the definition and is kept.

alter table public.platform_settings
  add column if not exists no_courier_cancel_minutes integer not null default 30
  check (no_courier_cancel_minutes between 10 and 360);

CREATE OR REPLACE FUNCTION public.expire_stale_orders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
declare
  v_expired record;
  v_count int := 0;
begin
  for v_expired in
    select o.id
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.status = 'pending_restaurant'
      and o.order_type = 'standard'   -- #1: never auto-cancel catering (quote flow)
      -- scheduled orders: SLA clock starts 60 min before the requested window,
      -- never before placement (past/near requested_for degrades to ASAP behavior)
      and greatest(o.created_at, coalesce(o.requested_for - interval '60 minutes', o.created_at))
          < now() - make_interval(mins => r.accept_sla_minutes)
  loop
    update public.orders
    set status = 'cancelled',
        cancellation_reason = 'Restaurantul nu a confirmat comanda la timp — anulare automată.'
    where id = v_expired.id and status = 'pending_restaurant';
    if found then
      insert into public.delivery_status_events (order_id, status, actor_role, note)
      values (v_expired.id, 'cancelled', 'system', 'accept SLA timeout');
      v_count := v_count + 1;
    end if;
  end loop;

  -- Zombie ready orders: ready_for_pickup, no courier, ready-state entered
  -- over 6h ago, and no future scheduled window that still justifies waiting.
  for v_expired in
    select o.id
    from public.orders o
    where o.status = 'ready_for_pickup'
      and o.courier_id is null
      and coalesce(o.requested_for + interval '2 hours', now() - interval '100 years') < now()
      and coalesce(
            (select max(e.created_at) from public.delivery_status_events e
             where e.order_id = o.id and e.status = 'ready_for_pickup'),
            o.created_at
          ) < now() - make_interval(mins => (select ps.no_courier_cancel_minutes
                                              from public.platform_settings ps where ps.id))
  loop
    update public.orders
    set status = 'cancelled',
        cancellation_reason = 'Nu am găsit un curier disponibil — anulare automată. Ne pare rău.'
    where id = v_expired.id and status = 'ready_for_pickup' and courier_id is null;
    if found then
      insert into public.delivery_status_events (order_id, status, actor_role, note)
      values (v_expired.id, 'cancelled', 'system', 'no courier found — ready-order timeout');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;
