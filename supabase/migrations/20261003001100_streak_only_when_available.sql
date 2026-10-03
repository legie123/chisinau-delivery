-- Ghost-streak fairness (review 2026-10-02, reproduced 2026-10-03 with two real sessions on a
-- throwaway clone). dispatch_order() reads the courier unlocked, so a courier who goes offline or
-- self-assigns between candidate selection and the offer insert holds a live offer he never saw
-- (close_stale_courier_shifts also offlines without declining). The sweeper then charged
-- consecutive_ignored_offers +1, and 3 such expiries ghost-offline a working courier.
-- Delta vs the live body (20261002000300 lineage): the loop also reads the offer's created_at,
-- and the streak UPDATE only fires when the courier is online now, holds no active order, touched
-- no order during the window, and no shift of his (re)started after the offer. Expiry, auto-offline and
-- re-dispatch are unchanged. Sim 71 (S6: a photo re-attach must not clear a strike).
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
    exception when others then null;  -- o comanda problematica nu omoara tot tick-ul
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
    exception when others then null;  -- o comanda problematica nu omoara tot tick-ul
    end;
  end loop;
  return v_count;
end;
$function$;
