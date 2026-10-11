-- Busy mode (migration 20261012000301_busy_mode). The partner taps +15/+30/+45 min
-- on the tablet; set_restaurant_busy stores it for one hour, get_prep_estimates adds
-- it (so the customer's ETA moves before ordering) and accept_order inherits it
-- (estimated_ready_at). Only the venue's own staff may set it. Rolled back by runner.
do $$
declare
  c_partner uuid := 'a0000000-0000-0000-0000-000000000003'; -- staffed at Sakura only
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_rest uuid := '11111111-1111-1111-1111-111111111111';    -- Sakura Sushi
  c_foreign uuid := 'd0000000-0000-0000-0000-000000000003'; -- Nobu, not staffed by c_partner
  v_base int; v_prep int; v_p90 numeric; v_p90_busy numeric; v_order uuid; v_ready timestamptz; v_until timestamptz; v_extra int;
begin
  select prep_minutes into v_base from public.get_prep_estimates(array[c_rest]);

  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- B1: own staff sets +30 → stored for ~1 hour
  perform public.set_restaurant_busy(c_rest, 30);
  select busy_extra_minutes, busy_until into v_extra, v_until from public.restaurants where id = c_rest;
  if v_extra is distinct from 30 then raise exception 'B1: busy_extra_minutes=% (want 30)', v_extra; end if;
  if v_until < now() + interval '55 minutes' or v_until > now() + interval '65 minutes' then
    raise exception 'B1: busy_until=% not ~1h ahead', v_until; end if;

  -- B2: the customer-facing estimate includes the extra minutes
  select prep_minutes into v_prep from public.get_prep_estimates(array[c_rest]);
  if v_prep <> v_base + 30 then raise exception 'B2: prep=% want %', v_prep, v_base + 30; end if;

  -- B3: accepting an order inherits it in estimated_ready_at
  reset role;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, c_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 30, 230)
  returning id into v_order;
  set local role authenticated;
  perform public.accept_order(v_order);
  select estimated_ready_at into v_ready from public.orders where id = v_order;
  if abs(extract(epoch from (v_ready - (now() + make_interval(mins => v_base + 30))))) > 5 then
    raise exception 'B3: estimated_ready_at=% want now()+% min', v_ready, v_base + 30; end if;

  -- B4: only 0/15/30/45 accepted
  begin
    perform public.set_restaurant_busy(c_rest, 20);
    raise exception 'B4: 20 min accepted';
  exception when others then
    if sqlerrm like 'B4:%' then raise; end if;
  end;

  -- B5: partner cannot set busy on a venue they do not staff
  begin
    perform public.set_restaurant_busy(c_foreign, 15);
    raise exception 'B5: foreign venue accepted';
  exception when others then
    if sqlerrm like 'B5:%' then raise; end if;
  end;

  -- B6: a customer cannot either
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.set_restaurant_busy(c_rest, 0);
    raise exception 'B6: customer accepted';
  exception when others then
    if sqlerrm like 'B6:%' then raise; end if;
  end;

  -- B7: 0 turns it off
  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  perform public.set_restaurant_busy(c_rest, 0);
  select prep_minutes into v_prep from public.get_prep_estimates(array[c_rest]);
  if v_prep <> v_base then raise exception 'B7: prep=% after off, want %', v_prep, v_base; end if;

  -- B8: an expired window adds nothing (forgotten busy mode must not stick)
  perform public.set_restaurant_busy(c_rest, 45);
  reset role;
  update public.restaurants set busy_until = now() - interval '1 minute' where id = c_rest;
  select prep_minutes into v_prep from public.get_prep_estimates(array[c_rest]);
  if v_prep <> v_base then raise exception 'B8: expired busy still adds (prep=%)', v_prep; end if;

  -- B9: anon has no execute
  if has_function_privilege('anon', 'public.set_restaurant_busy(uuid,int)', 'execute') then
    raise exception 'B9: anon can execute set_restaurant_busy'; end if;

  -- B10 (red-team F1): a direct partner UPDATE cannot set busy mode — only the RPC
  -- (with its 0/15/30/45 + one-hour rule) may; the column guard reverts the write.
  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.restaurants set busy_extra_minutes = 45, busy_until = '2099-12-31' where id = c_rest;
  reset role;
  select busy_extra_minutes, busy_until into v_extra, v_until from public.restaurants where id = c_rest;
  if v_until > now() + interval '2 hours' then raise exception 'B10: direct write set busy_until=%', v_until; end if;

  -- B11 (red-team F3): the p90 moves with the extra minutes, so the customer's
  -- range stays measured instead of falling back to a fixed spread.
  insert into public.restaurant_prep_stats (restaurant_id, hour_of_day, avg_prep_minutes, sample_count, p90_prep_minutes)
  values (c_rest, date_part('hour', now() at time zone 'Europe/Chisinau')::int, 20, 50, 32)
  on conflict (restaurant_id, hour_of_day) do update set avg_prep_minutes = 20, sample_count = 50, p90_prep_minutes = 32;
  update public.restaurants set busy_extra_minutes = 0, busy_until = null where id = c_rest;
  select p90_prep_minutes into v_p90 from public.get_prep_estimates(array[c_rest]);
  update public.restaurants set busy_extra_minutes = 30, busy_until = now() + interval '1 hour' where id = c_rest;
  select p90_prep_minutes into v_p90_busy from public.get_prep_estimates(array[c_rest]);
  if v_p90_busy is distinct from v_p90 + 30 then raise exception 'B11: p90 % busy % (want +30)', v_p90, v_p90_busy; end if;

  raise notice 'busy mode sims B1-B11 OK';
end $$;
