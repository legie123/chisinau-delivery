-- Master-audit Faza 3 #3 — externalized dispatch scoring weights (alpha0,
-- alpha1, alpha2). Mirrors 18_pricing_config.sql's shape (versioned immutable
-- config + admin-only setter), PLUS a live proof that dispatch_order() ACTUALLY
-- consumes the current version, not just that the table exists. Rolled back
-- by the runner.

-- ===== config table: seed, auth guard, immutability =====
do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_other uuid := 'a0000000-0000-0000-0000-000000000002'; -- courier, not admin
  v_cur record; v_new_id uuid; v_rows int; v_raised boolean;
begin
  -- current config = seeded v1 (alpha0=1.0, alpha1=10.0, alpha2=0)
  select * into v_cur from public.current_dispatch_scoring_config();
  if v_cur.alpha0 <> 1.0 or v_cur.alpha1 <> 10.0 or v_cur.alpha2 <> 0 then
    raise exception 'FAIL: v1 weights alpha0=%, alpha1=%, alpha2=% (expected 1.0/10.0/0)', v_cur.alpha0, v_cur.alpha1, v_cur.alpha2;
  end if;

  -- guard: a non-admin cannot retune dispatch scoring
  perform set_config('request.jwt.claims', json_build_object('sub', v_other,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.set_dispatch_scoring_config(5, 5, 0, now(), 'hack'); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: non-admin changed dispatch scoring weights'; end if;

  -- guard: the internal getter is revoked from every client role (defense in
  -- depth) — proven by an actual role switch, not just the JWT claim.
  v_raised := false;
  begin
    set local role authenticated;
    perform public.current_dispatch_scoring_config();
  exception when others then
    v_raised := true;
  end;
  reset role;
  if not v_raised then raise exception 'FAIL: authenticated role could call current_dispatch_scoring_config directly (revoke not enforced)'; end if;

  -- admin appends a NEW version
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  v_new_id := public.set_dispatch_scoring_config(0.5, 8, 0, now() + interval '1 day', 'test: retune');

  select count(*) into v_rows from public.dispatch_scoring_config;
  if v_rows <> 2 then raise exception 'FAIL: expected 2 weight versions, got %', v_rows; end if;

  -- a published version is IMMUTABLE
  v_raised := false;
  begin update public.dispatch_scoring_config set alpha0 = 1 where id = v_new_id; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a dispatch-scoring version was editable'; end if;
  v_raised := false;
  begin delete from public.dispatch_scoring_config where id = v_new_id; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a dispatch-scoring version was deletable'; end if;

  raise notice 'PASS dispatch-scoring-config: non-admin blocked (write+read), admin appended v2, versions immutable';
end $$;

-- ===== live proof: dispatch_order() actually READS the config, not a
-- hardcoded formula. A zero-weight version forces score = 0 regardless of
-- distance or acceptance history. =====
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid; v_item uuid; v_addr uuid; v_oid uuid; v_offer uuid; v_score numeric;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;
  select id into v_courier from public.couriers where user_id = v_courier_user;
  update public.orders set status = 'cancelled', courier_id = null
  where courier_id = v_courier and status in ('courier_assigned','picked_up','en_route');
  update public.couriers set status = 'offline' where id <> v_courier;
  update public.couriers set status = 'online', is_active = true where id = v_courier;
  -- far from the restaurant on purpose — under the default 1.0/10.0 weights
  -- this candidate would score well above 0; under a zeroed config it must not.
  insert into public.courier_locations (courier_id, lat, lng, updated_at)
  values (v_courier, 47.15, 28.95, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();

  -- admin zeroes the weights, effective immediately
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.set_dispatch_scoring_config(0, 0, 0, now(), 'test: prove dispatch_order reads live config');

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 10)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);

  select id, score into v_offer, v_score from public.dispatch_offers where order_id = v_oid and status = 'offered';
  if v_offer is null then raise exception 'FAIL: dispatch fired no offer'; end if;
  if v_score <> 0 then raise exception 'FAIL: score % with zeroed weights (expected 0 — dispatch_order ignored live config)', v_score; end if;

  raise notice 'PASS dispatch-scoring-config live: dispatch_order scored % with alpha0=alpha1=0 (config is live, not hardcoded)', v_score;
end $$;
