-- Ghost-streak fairness (20261003001100). dispatch_order() reads the courier without a lock, so
-- a courier who goes offline (set_courier_online_status) or self-assigns (assign_courier) between
-- candidate selection and the offer insert ends up holding a live offer he never saw. Reproduced
-- 2026-10-03 with two real sessions on a throwaway clone: offer lands on an 'offline' /
-- 'on_delivery' courier, the sweeper charges consecutive_ignored_offers +1 (3x = ghost-offline).
-- A single-session sim cannot interleave two transactions, so the busy cases insert the offer row
-- exactly as the racing dispatch_order does; the offline case uses a real single-session path
-- (close_stale_courier_shifts offlines without declining live offers).
-- Rule: an expiry counts only if the courier was online and free for the whole offer window.
--   S1 offline at expiry -> not charged      S2 on_delivery at expiry -> not charged, not re-offered
--   S3 busy at offer creation, freed before expiry -> not charged
--   S4 shift (re)started after the offer was created -> not charged
--   S5 control: online + free throughout -> charged (+1)

create function pg_temp.ready_order() returns uuid language plpgsql as $f$
declare v_oid uuid; v_item uuid; v_addr uuid;
begin
  select mi.id into v_item from public.menu_items mi
  where mi.restaurant_id = '11111111-1111-1111-1111-111111111111' and mi.is_available and not mi.is_catering_only
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl desc limit 1;
  select id into v_addr from public.addresses where customer_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  v_oid := public.place_order('11111111-1111-1111-1111-111111111111', 'standard', 'card_on_delivery',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);  -- dispatches to the courier if he is online + free
  return v_oid;
end $f$;

-- expire every live offer of the courier through the real sweeper, return his streak
create function pg_temp.sweep(p_courier uuid) returns int language plpgsql as $f$
declare v int;
begin
  update public.dispatch_offers set expires_at = now() - interval '1 second'
  where courier_id = p_courier and status = 'offered';
  perform public.expire_dispatch_offers();
  -- the scenario is only meaningful if the sweeper really expired the offer (not SKIP LOCKED-skipped)
  if exists (select 1 from public.dispatch_offers where courier_id = p_courier and status = 'offered') then
    raise exception 'FAIL sweep: an offer of the courier is still live after expire_dispatch_offers()';
  end if;
  select consecutive_ignored_offers into v from public.couriers where id = p_courier;
  return v;
end $f$;

-- clean slate between scenarios: no stray ready orders the rescue loop could hand out
create function pg_temp.reset(p_courier uuid) returns void language plpgsql as $f$
begin
  update public.dispatch_offers set status = 'cancelled' where status = 'offered';
  update public.orders set status = 'cancelled'
  where status = 'ready_for_pickup' and courier_id is null;
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = p_courier and status in ('courier_assigned','picked_up','en_route');
  update public.courier_shifts set ended_at = now() where courier_id = p_courier and ended_at is null;
  update public.couriers set status = 'offline', consecutive_ignored_offers = 0 where id = p_courier;
  perform set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
  perform public.set_courier_online_status('online');
  -- the shift began well before any offer of this scenario
  update public.courier_shifts set started_at = now() - interval '1 hour'
  where courier_id = p_courier and ended_at is null;
end $f$;

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cu uuid := 'c0000000-0000-0000-0000-000000000007';
  v_c uuid; v_a uuid; v_b uuid; v_offer uuid; v_streak int; v_status text; v_n int;
begin
  select id into v_c from public.couriers where user_id = v_cu;
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_c, 'refund_reversal', -public.courier_cash_balance(v_c), 'sim baseline (rolled back)'
  where public.courier_cash_balance(v_c) > 0;
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_c, 47.0245, 28.8322, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
  update public.couriers set status = 'offline' where id <> v_c;

  -- ===== S1: offline at expiry (offer left live by a path that offlines without declining) =====
  perform pg_temp.reset(v_c);
  v_a := pg_temp.ready_order();
  select id into v_offer from public.dispatch_offers where order_id = v_a and courier_id = v_c and status = 'offered';
  if v_offer is null then raise exception 'FAIL S1 arrange: no offer to the courier'; end if;
  update public.courier_shifts set started_at = now() - interval '17 hours'
  where courier_id = v_c and ended_at is null;
  perform public.close_stale_courier_shifts();
  select status into v_status from public.couriers where id = v_c;
  if v_status <> 'offline' then raise exception 'FAIL S1 arrange: courier still %', v_status; end if;
  v_streak := pg_temp.sweep(v_c);
  if v_streak <> 0 then raise exception 'FAIL S1: offline courier charged for an offer he never saw (streak %)', v_streak; end if;
  raise notice 'PASS S1: offline at expiry -> not charged';

  -- ===== S2: on_delivery at expiry (race: offer inserted after assign_courier) =====
  perform pg_temp.reset(v_c);
  update public.couriers set status = 'offline' where id = v_c;  -- so mark_ready does not offer
  v_a := pg_temp.ready_order();
  v_b := pg_temp.ready_order();
  update public.couriers set status = 'online' where id = v_c;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cu,'role','authenticated')::text, true);
  perform public.assign_courier(v_a);
  -- the row the racing dispatch_order(v_b) inserts (its candidate snapshot predates the assign)
  insert into public.dispatch_offers (order_id, courier_id, wave, score, distance_km, expires_at)
  values (v_b, v_c, 1, 1, 1, now() + interval '30 seconds');
  v_streak := pg_temp.sweep(v_c);
  if v_streak <> 0 then raise exception 'FAIL S2: on_delivery courier charged (streak %)', v_streak; end if;
  select count(*) into v_n from public.dispatch_offers where courier_id = v_c and status = 'offered';
  if v_n > 0 then raise exception 'FAIL S2: sweeper re-offered to the busy courier in the same tick'; end if;
  select status into v_status from public.couriers where id = v_c;
  if v_status <> 'on_delivery' then raise exception 'FAIL S2: courier status changed to %', v_status; end if;
  raise notice 'PASS S2: on_delivery at expiry -> not charged, not re-offered';

  -- ===== S3: busy when the offer was created, freed (order cancelled) before expiry =====
  perform pg_temp.reset(v_c);
  update public.couriers set status = 'offline' where id = v_c;
  v_a := pg_temp.ready_order();
  v_b := pg_temp.ready_order();
  update public.couriers set status = 'online' where id = v_c;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cu,'role','authenticated')::text, true);
  perform public.assign_courier(v_a);
  insert into public.dispatch_offers (order_id, courier_id, wave, score, distance_km, expires_at, created_at, offered_at)
  values (v_b, v_c, 1, 1, 1, now() + interval '10 seconds', now() - interval '20 seconds', now() - interval '20 seconds');
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  perform public.cancel_order(v_a, 'sim: freed mid-window');
  select status into v_status from public.couriers where id = v_c;
  if v_status <> 'online' then raise exception 'FAIL S3 arrange: courier not freed (%)', v_status; end if;
  v_streak := pg_temp.sweep(v_c);
  if v_streak <> 0 then raise exception 'FAIL S3: offer created while busy was charged (streak %)', v_streak; end if;
  raise notice 'PASS S3: busy at offer creation -> not charged';

  -- ===== S4: online at expiry, but the shift (re)started after the offer was created =====
  perform pg_temp.reset(v_c);
  v_a := pg_temp.ready_order();
  update public.dispatch_offers set created_at = now() - interval '20 seconds'
  where order_id = v_a and courier_id = v_c and status = 'offered';
  if not found then raise exception 'FAIL S4 arrange: no offer to the courier'; end if;
  update public.courier_shifts set started_at = now() - interval '5 seconds'
  where courier_id = v_c and ended_at is null;
  update public.couriers set consecutive_ignored_offers = 1 where id = v_c;  -- leftover streak
  v_streak := pg_temp.sweep(v_c);
  if v_streak <> 1 then raise exception 'FAIL S4: offer from before the current shift was charged (streak %)', v_streak; end if;
  raise notice 'PASS S4: shift started mid-window -> not charged';

  -- ===== S5: control — online and free the whole window still counts =====
  perform pg_temp.reset(v_c);
  v_a := pg_temp.ready_order();
  perform 1 from public.dispatch_offers where order_id = v_a and courier_id = v_c and status = 'offered';
  if not found then raise exception 'FAIL S5 arrange: no offer to the courier'; end if;
  v_streak := pg_temp.sweep(v_c);
  if v_streak <> 1 then raise exception 'FAIL S5: genuinely ignored offer not charged (streak %)', v_streak; end if;
  raise notice 'PASS S5: online + free throughout -> charged';

  -- ===== S6: the courier cannot clear a strike by touching an old order of his =====
  -- (verifier 2026-10-03, reproduced with committed transactions on a real clock: with
  -- orders.updated_at as the "freed" signal, re-attaching the delivery photo on his last delivered
  -- order bumped updated_at past the offer's created_at and voided the charge). Inside one
  -- rolled-back transaction now() is frozen, so the bump is set explicitly to what the trigger
  -- would write 20s later on a live clock.
  perform pg_temp.reset(v_c);
  v_a := pg_temp.ready_order();
  perform 1 from public.dispatch_offers where order_id = v_a and courier_id = v_c and status = 'offered';
  if not found then raise exception 'FAIL S6 arrange: no offer'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cu, 'role', 'authenticated')::text, true);
  perform public.accept_dispatch_offer((select id from public.dispatch_offers where order_id = v_a and courier_id = v_c and status = 'offered'));
  perform public.advance_delivery_status(v_a, 'picked_up', null);
  perform public.advance_delivery_status(v_a, 'en_route', null);
  perform public.advance_delivery_status(v_a, 'delivered', true);
  -- the delivery happened well before the next offer window
  alter table public.orders disable trigger orders_set_updated_at;
  update public.orders set delivered_at = now() - interval '10 minutes', updated_at = now() - interval '10 minutes' where id = v_a;
  update public.couriers set consecutive_ignored_offers = 0 where id = v_c;
  v_b := pg_temp.ready_order();
  perform 1 from public.dispatch_offers where order_id = v_b and courier_id = v_c and status = 'offered';
  if not found then raise exception 'FAIL S6 arrange: no second offer'; end if;
  -- mid-window: courier re-attaches the photo on the OLD order (a write he controls) -> updated_at
  -- lands strictly after the offer's created_at, as the trigger does on a live clock
  perform set_config('request.jwt.claims', json_build_object('sub', v_cu, 'role', 'authenticated')::text, true);
  perform public.attach_delivery_proof(v_a, v_a::text || '/proof.jpg');
  update public.orders set updated_at = now() + interval '20 seconds' where id = v_a;
  alter table public.orders enable trigger orders_set_updated_at;
  v_streak := pg_temp.sweep(v_c);
  if v_streak <> 1 then raise exception 'FAIL S6: strike dodged by touching an old order (streak %)', v_streak; end if;
  raise notice 'PASS S6: touching an old delivered order does not clear a strike';

  -- ===== S7: online but with no open shift (close_stale_courier_shifts closed it mid-delivery) =====
  -- (verifier 2026-10-03: "exists open shift started before the offer" never charged such a courier
  -- again; the real condition is "no shift started AFTER the offer")
  perform pg_temp.reset(v_c);
  update public.courier_shifts set ended_at = now() - interval '1 minute' where courier_id = v_c and ended_at is null;
  update public.couriers set status = 'online' where id = v_c;
  v_a := pg_temp.ready_order();
  perform 1 from public.dispatch_offers where order_id = v_a and courier_id = v_c and status = 'offered';
  if not found then raise exception 'FAIL S7 arrange: no offer'; end if;
  v_streak := pg_temp.sweep(v_c);
  if v_streak <> 1 then raise exception 'FAIL S7: online courier without an open shift not charged (streak %)', v_streak; end if;
  raise notice 'PASS S7: online without an open shift -> still charged';
end $$;
