-- Dispatch failures are recorded instead of swallowed.
-- expire_dispatch_offers() (pg_cron every 15s) caught every dispatch_order() error with
-- `exception when others then null`: an order that always failed to dispatch stayed in
-- ready_for_pickup with no offer and no trace. Now each failure lands in dispatch_errors,
-- one row per (order, error_code = SQLSTATE) with a repeat count, readable by platform admins only.
-- The function is recreated from its LIVE body (20261003001100) with that one delta;
-- its SET statement_timeout clause is part of the definition and is kept.
-- ponytail: no retention job; rows are bounded by orders x error codes, add a purge if it grows.

create table if not exists public.dispatch_errors (
  order_id  uuid        not null references public.orders(id) on delete cascade,
  error_code text       not null,
  phase     text        not null check (phase in ('expire', 'sweep')),
  message   text        not null,
  count     integer     not null default 1,
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now(),
  primary key (order_id, error_code)
);

alter table public.dispatch_errors enable row level security;
drop policy if exists "dispatch_errors_admin_read" on public.dispatch_errors;
create policy "dispatch_errors_admin_read" on public.dispatch_errors
  for select to authenticated, viewer using ((select public.has_role('platform_admin')));
-- View-as parity (20261004000100, sim 73): viewer reads what authenticated reads, only
-- inside a live view-as session.
drop policy if exists viewer_session_live on public.dispatch_errors;
create policy viewer_session_live on public.dispatch_errors
  as restrictive for select to viewer using ((select public.viewer_session_live()));
revoke all on public.dispatch_errors from anon, authenticated;
grant select on public.dispatch_errors to authenticated, viewer;

CREATE OR REPLACE FUNCTION public.expire_dispatch_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
declare
  v_rec record;
  v_count int := 0;
  v_streak int;
  v_courier_user uuid;
begin
  for v_rec in
    select id, order_id, courier_id, created_at from public.dispatch_offers
    where status = 'offered' and expires_at < now()
    order by expires_at
  loop
    perform 1 from public.couriers where id = v_rec.courier_id for no key update skip locked;
    if not found then continue; end if;
    perform 1 from public.orders where id = v_rec.order_id for update skip locked;
    if not found then continue; end if;
    update public.dispatch_offers
    set status = 'expired', responded_at = now()
    where id = v_rec.id and status = 'offered' and expires_at < now();
    if not found then continue; end if;

    -- Only an offer the courier could have seen and taken counts: online and free for the whole
    -- window. No row updated -> v_streak is NULL -> no auto-offline.
    -- "Freed during the window" is derived from timestamps the courier does NOT control:
    -- delivered_at (set by advance_delivery_status) or a cancellation. orders.updated_at was the
    -- first draft and let a courier dodge his strikes by re-attaching a delivery photo
    -- (attach_delivery_proof bumps updated_at) — found by the adversarial verifier 2026-10-03.
    update public.couriers c
    set consecutive_ignored_offers = consecutive_ignored_offers + 1
    where c.id = v_rec.courier_id
      and c.status = 'online'
      -- no shift (re)started inside the window: a courier who came online mid-window could not have
      -- seen the offer (S4). Phrased as NOT EXISTS, not "has an open shift started before": an online
      -- courier whose 16h shift was closed by close_stale_courier_shifts while on_delivery has no open
      -- shift at all and would otherwise never be charged again (verifier 2026-10-03).
      and not exists (select 1 from public.courier_shifts s
                      where s.courier_id = c.id and s.started_at > v_rec.created_at)
      and not exists (select 1 from public.orders o
                      where o.courier_id = c.id
                        and (o.status in ('courier_assigned', 'picked_up', 'en_route')
                             or o.delivered_at > v_rec.created_at
                             or (o.status = 'cancelled' and o.updated_at > v_rec.created_at)))
    returning consecutive_ignored_offers into v_streak;

    if v_streak >= 3 then
      update public.courier_shifts set ended_at = now()
      where courier_id = v_rec.courier_id and ended_at is null;

      update public.dispatch_offers set status = 'declined', responded_at = now()
      where courier_id = v_rec.courier_id and status = 'offered';

      update public.couriers set status = 'offline', consecutive_ignored_offers = 0
      where id = v_rec.courier_id
      returning user_id into v_courier_user;

      if v_courier_user is not null then
        insert into public.notification_outbox (user_id, title, body, url, tag)
        values (
          v_courier_user,
          'Trecut offline automat',
          'Te-am trecut offline după 3 oferte ratate — revino online când ești gata.',
          '/deliveries',
          'dispatch'
        );
      end if;
    end if;

    begin
      perform public.dispatch_order(v_rec.order_id);
    exception when others then
      -- o comanda problematica nu omoara tot tick-ul, dar nici nu mai dispare in tacere
      insert into public.dispatch_errors (order_id, phase, error_code, message)
      values (v_rec.order_id, 'expire', sqlstate, sqlerrm)
      on conflict (order_id, error_code) do update
        set count = public.dispatch_errors.count + 1, last_at = now(),
            message = excluded.message, phase = excluded.phase;
    end;
    v_count := v_count + 1;
  end loop;

  for v_rec in
    select o.id as order_id from public.orders o
    where o.status = 'ready_for_pickup' and o.courier_id is null
      and not exists (select 1 from public.dispatch_offers d
                      where d.order_id = o.id and d.status = 'offered')
  loop
    begin
      perform public.dispatch_order(v_rec.order_id);
    exception when others then
      -- o comanda problematica nu omoara tot tick-ul, dar nici nu mai dispare in tacere
      insert into public.dispatch_errors (order_id, phase, error_code, message)
      values (v_rec.order_id, 'sweep', sqlstate, sqlerrm)
      on conflict (order_id, error_code) do update
        set count = public.dispatch_errors.count + 1, last_at = now(),
            message = excluded.message, phase = excluded.phase;
    end;
  end loop;
  return v_count;
end;
$function$;
