-- Deadlock between the offer sweeper and accept_dispatch_offer (reproduced 2026-10-02 by
-- scripts/concurrency: ~1 per 54 accept-at-expiry races). accept locks courier -> order -> offer;
-- the sweeper's bulk UPDATE locked every expired offer first, then the courier: a cycle.
-- Delta vs the live body (20260727001700 lineage): the first loop now takes courier -> order ->
-- offer in accept's order, each with SKIP LOCKED, so the sweeper never waits on a courier who is
-- mid-accept. A skipped offer is simply expired on the next tick (15s). Rest unchanged.
create or replace function public.expire_dispatch_offers()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
  v_rec record;
  v_count int := 0;
  v_streak int;
  v_courier_user uuid;
begin
  for v_rec in
    select id, order_id, courier_id from public.dispatch_offers
    where status = 'offered' and expires_at < now()
    order by expires_at
  loop
    perform 1 from public.couriers where id = v_rec.courier_id for update skip locked;
    if not found then continue; end if;
    perform 1 from public.orders where id = v_rec.order_id for update skip locked;
    if not found then continue; end if;
    update public.dispatch_offers
    set status = 'expired', responded_at = now()
    where id = v_rec.id and status = 'offered' and expires_at < now();
    if not found then continue; end if;

    update public.couriers
    set consecutive_ignored_offers = consecutive_ignored_offers + 1
    where id = v_rec.courier_id
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
