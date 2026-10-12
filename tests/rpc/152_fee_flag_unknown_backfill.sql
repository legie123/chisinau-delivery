-- Three-valued courier_fee_distance_assumed + backfill (migration 20261012000204).
-- Before: NOT NULL DEFAULT false made every delivery older than the flag read "measured", even with a
-- pin missing. After: historic + pin missing -> true; historic + both pins -> null (unknown); measured
-- values written after the cutoff and every true are left alone; nothing that is not delivered moves;
-- no amount moves. The ROLLBACK written in the migration is executed at the end.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_r1 uuid; v_r1lat numeric; v_r1lng numeric; v_r2 uuid;
  v_pin uuid; v_nopin uuid; v_c uuid;
  h_nopin_addr uuid; h_nopin_rest uuid; h_pins uuid; n_measured uuid; n_true uuid; h_true_pins uuid; inflight uuid;
  v_cut timestamptz := now() - interval '1 day';
  v_fees_before numeric; v_fees_after numeric; v_ret int; v_flag boolean; v_nullable text; v_default text;
  function_gone boolean; v_half uuid; h_half uuid; v_erased uuid; h_erased uuid;
begin
  select id, lat, lng into v_r1, v_r1lat, v_r1lng from public.restaurants where is_active and lat is not null order by name limit 1;
  select id into v_r2 from public.restaurants where is_active and lat is not null and id <> v_r1 order by name limit 1;
  update public.restaurants set lat = null, lng = null where id = v_r2;   -- restaurant without a pin
  insert into public.addresses (customer_id, street_address, lat, lng) values (c_cust, 'Str. Sim 152 pin', v_r1lat + 0.02, v_r1lng) returning id into v_pin;
  insert into public.addresses (customer_id, street_address) values (c_cust, 'Str. Sim 152 fara pin') returning id into v_nopin;
  select id into v_c from public.couriers where is_active order by id limit 1;

  -- delivered fixtures: (restaurant, address, delivered_at, flag)
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_fee_mdl, delivered_at, courier_fee_distance_assumed)
  values ('standard', c_cust, v_r1, v_nopin, 'delivered', 'cash', 'paid', 200, 30, 230, v_c, 66, v_cut - interval '1 day', false) returning id into h_nopin_addr;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_fee_mdl, delivered_at, courier_fee_distance_assumed)
  values ('standard', c_cust, v_r2, v_pin, 'delivered', 'cash', 'paid', 200, 30, 230, v_c, 66, v_cut - interval '1 day', false) returning id into h_nopin_rest;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_fee_mdl, delivered_at, courier_fee_distance_assumed)
  values ('standard', c_cust, v_r1, v_pin, 'delivered', 'cash', 'paid', 200, 30, 230, v_c, 41.5, v_cut - interval '1 day', false) returning id into h_pins;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_fee_mdl, delivered_at, courier_fee_distance_assumed)
  values ('standard', c_cust, v_r1, v_pin, 'delivered', 'cash', 'paid', 200, 30, 230, v_c, 41.5, v_cut + interval '1 hour', false) returning id into n_measured;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_fee_mdl, delivered_at, courier_fee_distance_assumed)
  values ('standard', c_cust, v_r1, v_nopin, 'delivered', 'cash', 'paid', 200, 30, 230, v_c, 66, v_cut + interval '1 hour', true) returning id into n_true;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_fee_mdl, delivered_at, courier_fee_distance_assumed)
  values ('standard', c_cust, v_r1, v_pin, 'delivered', 'cash', 'paid', 200, 30, 230, v_c, 66, v_cut - interval '1 day', true) returning id into h_true_pins;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_fee_distance_assumed, delivered_at)
  -- not delivered, yet carrying a delivered_at (corrupt data / an admin edit): only the status filter keeps it out
  values ('standard', c_cust, v_r1, v_nopin, 'cancelled', 'cash', 'unpaid', 200, 30, 230, v_c, false, v_cut - interval '1 day') returning id into inflight;

  -- half pin (lat only) and an address erased AFTER delivery (erase_customer_pii marker)
  insert into public.addresses (customer_id, street_address, lat) values (c_cust, 'Str. Sim 152 jumatate', v_r1lat) returning id into v_half;
  insert into public.addresses (customer_id, street_address) values (c_cust, 'Adresă ștearsă') returning id into v_erased;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_fee_mdl, delivered_at, courier_fee_distance_assumed)
  values ('standard', c_cust, v_r1, v_half, 'delivered', 'cash', 'paid', 200, 30, 230, v_c, 66, v_cut - interval '1 day', false) returning id into h_half;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id, courier_fee_mdl, delivered_at, courier_fee_distance_assumed)
  values ('standard', c_cust, v_r1, v_erased, 'delivered', 'cash', 'paid', 200, 30, 230, v_c, 41.5, v_cut - interval '1 day', false) returning id into h_erased;

  select sum(courier_fee_mdl) into v_fees_before from public.orders;
  v_ret := public.backfill_courier_fee_distance_assumed(v_cut);

  -- ===== U1: historic delivery, address without a pin -> true =====
  select courier_fee_distance_assumed into v_flag from public.orders where id = h_nopin_addr;
  if v_flag is distinct from true then raise exception 'FAIL 152.U1: historic pinless address -> % (expected true)', v_flag; end if;
  raise notice 'PASS 152.U1: historic delivery to an unpinned address -> true';
  -- ===== U2: historic delivery, restaurant without a pin -> true =====
  select courier_fee_distance_assumed into v_flag from public.orders where id = h_nopin_rest;
  if v_flag is distinct from true then raise exception 'FAIL 152.U2: historic unpinned restaurant -> % (expected true)', v_flag; end if;
  raise notice 'PASS 152.U2: historic delivery from an unpinned restaurant -> true';
  -- ===== U3: historic delivery, both pins present -> null (unknown), NOT false (measured) =====
  select courier_fee_distance_assumed into v_flag from public.orders where id = h_pins;
  if v_flag is not null then raise exception 'FAIL 152.U3: historic pinned delivery -> % (expected null = unknown)', v_flag; end if;
  raise notice 'PASS 152.U3: historic pinned delivery -> null (unknown, not "measured")';
  -- ===== U4: values written after the cutoff are left alone (measured false, assumed true) =====
  select courier_fee_distance_assumed into v_flag from public.orders where id = n_measured;
  if v_flag is distinct from false then raise exception 'FAIL 152.U4: measured flag after the cutoff changed to %', v_flag; end if;
  select courier_fee_distance_assumed into v_flag from public.orders where id = n_true;
  if v_flag is distinct from true then raise exception 'FAIL 152.U4: assumed flag after the cutoff changed to %', v_flag; end if;
  raise notice 'PASS 152.U4: flags written after the cutoff untouched';
  -- ===== U5: monotone — a true stays true even if both pins exist now =====
  select courier_fee_distance_assumed into v_flag from public.orders where id = h_true_pins;
  if v_flag is distinct from true then raise exception 'FAIL 152.U5: a true was downgraded to %', v_flag; end if;
  raise notice 'PASS 152.U5: true is never downgraded';
  -- ===== U6: an order that is not delivered is not touched, even with a delivered_at =====
  select courier_fee_distance_assumed into v_flag from public.orders where id = inflight;
  if v_flag is distinct from false then raise exception 'FAIL 152.U6: not-delivered order touched (now %)', v_flag; end if;
  raise notice 'PASS 152.U6: not-delivered order untouched';
  -- ===== U11: half a pin (lat without lng) is no pin -> true =====
  select courier_fee_distance_assumed into v_flag from public.orders where id = h_half;
  if v_flag is distinct from true then raise exception 'FAIL 152.U11: half pin -> % (expected true)', v_flag; end if;
  raise notice 'PASS 152.U11: lat without lng -> true';
  -- ===== U12: an address erased after delivery is unknown (null), not "6 km assumed" =====
  select courier_fee_distance_assumed into v_flag from public.orders where id = h_erased;
  if v_flag is not null then raise exception 'FAIL 152.U12: erased address -> % (expected null)', v_flag; end if;
  raise notice 'PASS 152.U12: address erased after delivery -> null';

  -- ===== U7: idempotent, and no amount moved =====
  v_ret := public.backfill_courier_fee_distance_assumed(v_cut);
  if v_ret <> 0 then raise exception 'FAIL 152.U7: second run changed % rows', v_ret; end if;
  select sum(courier_fee_mdl) into v_fees_after from public.orders;
  if v_fees_after is distinct from v_fees_before then raise exception 'FAIL 152.U7: courier fees moved (% -> %)', v_fees_before, v_fees_after; end if;
  raise notice 'PASS 152.U7: second run changes 0 rows; total courier fees unchanged (%)', v_fees_after;
  -- ===== U8: new orders start as null (not evaluated), not false =====
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_r1, v_pin, 'ready_for_pickup', 'cash', 'unpaid', 200, 30, 230) returning courier_fee_distance_assumed into v_flag;
  if v_flag is not null then raise exception 'FAIL 152.U8: a new order starts as % (expected null)', v_flag; end if;
  raise notice 'PASS 152.U8: a new order starts as null';
  -- ===== U9: only postgres may run the backfill =====
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.backfill_courier_fee_distance_assumed(v_cut);
    reset role;
    raise exception 'FAIL 152.U9: authenticated could run the backfill';
  exception when insufficient_privilege then
    reset role;
  end;
  set local role service_role;
  begin
    perform public.backfill_courier_fee_distance_assumed(v_cut);
    reset role;
    raise exception 'FAIL 152.U9: service_role could run the backfill';
  exception when insufficient_privilege then
    reset role;
  end;
  raise notice 'PASS 152.U9: authenticated and service_role are denied';

  -- ===== U10: the ROLLBACK written in the migration works and keeps the trues =====
  update public.orders set courier_fee_distance_assumed = false where courier_fee_distance_assumed is null;
  alter table public.orders alter column courier_fee_distance_assumed set default false,
                            alter column courier_fee_distance_assumed set not null;
  drop function public.backfill_courier_fee_distance_assumed(timestamptz);
  select is_nullable, column_default into v_nullable, v_default from information_schema.columns
   where table_schema = 'public' and table_name = 'orders' and column_name = 'courier_fee_distance_assumed';
  select not exists (select 1 from pg_proc where proname = 'backfill_courier_fee_distance_assumed') into function_gone;
  select courier_fee_distance_assumed into v_flag from public.orders where id = h_nopin_addr;
  if v_nullable <> 'NO' or v_default <> 'false' or not function_gone or v_flag is distinct from true then
    raise exception 'FAIL 152.U10: rollback left nullable=% default=% function_gone=% backfilled=%', v_nullable, v_default, function_gone, v_flag;
  end if;
  raise notice 'PASS 152.U10: rollback restores NOT NULL DEFAULT false, drops the function, keeps the trues';
end $$;
