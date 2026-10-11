-- 253: a ready order nobody picks up is cancelled after platform_settings.no_courier_cancel_minutes
-- (default 30, decided by the owner 2026-10-12; was a hardcoded 6 hours), and the customer gets the
-- "Comanda a fost anulată" push through the existing status-event trigger. Migration 20261012000405.
do $$
declare
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid;
  v_old uuid;
  v_fresh uuid;
  v_status text;
  v_push int;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, order_number)
  values ('standard', v_cust, v_rest, 'ready_for_pickup', 'cash', 'unpaid', 200, 20, 220, 'SIM253-OLD'),
         ('standard', v_cust, v_rest, 'ready_for_pickup', 'cash', 'unpaid', 200, 20, 220, 'SIM253-NEW');
  select id into v_old from public.orders where order_number = 'SIM253-OLD';
  select id into v_fresh from public.orders where order_number = 'SIM253-NEW';
  update public.orders set created_at = now() - interval '60 minutes' where id in (v_old, v_fresh);
  insert into public.delivery_status_events (order_id, status, actor_role, note, created_at)
  values (v_old, 'ready_for_pickup', 'system', 'sim', now() - interval '40 minutes'),
         (v_fresh, 'ready_for_pickup', 'system', 'sim', now() - interval '20 minutes');

  -- 253.1 default 30 min: the 40-min one is cancelled, the 20-min one waits
  perform public.expire_stale_orders();
  select status into v_status from public.orders where id = v_old;
  if v_status <> 'cancelled' then raise exception 'FAIL 253.1: 40 min without a courier, status %', v_status; end if;
  select status into v_status from public.orders where id = v_fresh;
  if v_status <> 'ready_for_pickup' then raise exception 'FAIL 253.1: 20 min ready order was %', v_status; end if;
  raise notice 'PASS 253.1: cancelled after 30 min without a courier, younger order untouched';

  -- 253.2 the customer is told
  select count(*) into v_push from public.notification_outbox
   where user_id = v_cust and tag = 'order-' || v_old::text and title = 'Comanda a fost anulată';
  if v_push <> 1 then raise exception 'FAIL 253.2: % cancellation pushes for the customer, expected 1', v_push; end if;
  raise notice 'PASS 253.2: customer push enqueued';

  -- 253.3 configurable: at 15 min the 20-min order goes too
  update public.platform_settings set no_courier_cancel_minutes = 15 where id;
  perform public.expire_stale_orders();
  select status into v_status from public.orders where id = v_fresh;
  if v_status <> 'cancelled' then raise exception 'FAIL 253.3: setting 15 min did not apply, status %', v_status; end if;
  raise notice 'PASS 253.3: the cut-off follows platform_settings';

  -- 253.4 out-of-range values are refused
  begin
    update public.platform_settings set no_courier_cancel_minutes = 2 where id;
    raise exception 'FAIL 253.4: 2 minutes accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 253.4: cut-off bounded';
end $$;
