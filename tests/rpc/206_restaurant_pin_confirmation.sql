-- Pin rule A (owner decision 2026-10-12; migration 20261012000308_restaurant_pin_confirmation).
-- The partner confirms on the map that the pin is the pickup door; the confirmation is
-- cleared whenever the pin moves; nobody can fake it with a direct write. ADMIN gates
-- activation on it. Rolled back by runner.
do $$
declare
  c_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  c_foreign uuid := 'd0000000-0000-0000-0000-000000000003';
  v_at timestamptz;
begin
  update public.restaurants set pin_confirmed_at = null where id in (c_rest, c_foreign);
  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- P1: own staff confirms → stamped
  perform public.confirm_restaurant_pin(c_rest);
  select pin_confirmed_at into v_at from public.restaurants where id = c_rest;
  if v_at is null then raise exception 'P1: confirmation not stored'; end if;

  -- P2: a direct write cannot fake or move it (partner has table-level UPDATE)
  update public.restaurants set pin_confirmed_at = now() + interval '1 day' where id = c_rest;
  select pin_confirmed_at into v_at from public.restaurants where id = c_rest;
  if v_at > now() + interval '1 hour' then raise exception 'P2: direct write changed pin_confirmed_at'; end if;

  -- P3: the admin moves the pin → confirmation cleared
  reset role;
  update public.restaurants set lat = lat + 0.001 where id = c_rest;
  select pin_confirmed_at into v_at from public.restaurants where id = c_rest;
  if v_at is not null then raise exception 'P3: pin moved but confirmation kept'; end if;

  -- P4: no confirmation without a pin
  update public.restaurants set lat = null, lng = null where id = c_rest;
  set local role authenticated;
  begin perform public.confirm_restaurant_pin(c_rest); raise exception 'P4: confirmed a restaurant with no pin';
  exception when raise_exception then if sqlerrm like 'P4:%' then raise; end if; end;

  -- P5: not another restaurant, not a customer
  begin perform public.confirm_restaurant_pin(c_foreign); raise exception 'P5: confirmed a foreign restaurant';
  exception when raise_exception then if sqlerrm like 'P5:%' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin perform public.confirm_restaurant_pin(c_foreign); raise exception 'P5b: customer confirmed';
  exception when raise_exception then if sqlerrm like 'P5b:%' then raise; end if; end;
  reset role;
  if has_function_privilege('anon', 'public.confirm_restaurant_pin(uuid)', 'execute') then raise exception 'P6: anon can execute'; end if;

  raise notice 'pin confirmation P1-P6 OK';
end $$;
