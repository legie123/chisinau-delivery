-- benchdb only. Harness for concurrency + burst load.
create table if not exists bench_log(id bigserial, kind text, actor uuid, order_id uuid, ok bool, err text, at timestamptz default clock_timestamp());
truncate bench_log;

create or replace procedure bench_arrange() language plpgsql as $$
declare v_rest uuid := '11111111-1111-1111-1111-111111111111';
begin
  delete from restaurant_hours where restaurant_id = v_rest;
  insert into restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
    select v_rest, d, '00:00', '00:00', false from generate_series(0,6) d;
  update orders set status='cancelled' where status not in ('delivered','cancelled','rejected');
  update dispatch_offers set status='cancelled' where status='offered';
  insert into courier_cash_movements (courier_id, kind, amount_mdl, note)
    select id,'offload',-courier_cash_balance(id),'bench' from couriers where courier_cash_balance(id) > 0;
  update couriers set status='offline', consecutive_ignored_offers=0;
  insert into courier_locations (courier_id, lat, lng, updated_at)
    select id, 47.0245 + random()*0.004, 28.8322 + random()*0.004, now() from couriers
    on conflict (courier_id) do update set lat=excluded.lat, lng=excluded.lng, updated_at=now();
end $$;

create or replace function bench_item() returns uuid language sql as $$
  select mi.id from menu_items mi where mi.restaurant_id='11111111-1111-1111-1111-111111111111' and mi.is_available
    and not mi.is_catering_only and mi.price_mdl between 260 and 1300
    and not exists (select 1 from menu_option_groups g where g.menu_item_id=mi.id and g.is_required)
  order by mi.price_mdl limit 1 $$;

-- customer places p_n orders, one commit each
create or replace procedure bench_place(p_n int) language plpgsql as $$
declare v_addr uuid; v_oid uuid; i int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, false);
  select id into v_addr from addresses where customer_id='a0000000-0000-0000-0000-000000000001' limit 1;
  for i in 1..p_n loop
    begin
      v_oid := place_order('11111111-1111-1111-1111-111111111111','standard','card_on_delivery',
        jsonb_build_array(jsonb_build_object('menu_item_id', bench_item(), 'quantity', 1)), v_addr, null, null, null);
      insert into bench_log(kind, order_id, ok) values ('place', v_oid, true);
    exception when others then insert into bench_log(kind, ok, err) values ('place', false, sqlerrm); end;
    commit;
  end loop;
end $$;

-- partner: accept + mark ready everything pending, until p_seconds elapse
create or replace procedure bench_partner(p_seconds int) language plpgsql as $$
declare v_end timestamptz := clock_timestamp() + make_interval(secs => p_seconds); r record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000003','role','authenticated')::text, false);
  while clock_timestamp() < v_end loop
    for r in select id, status from orders where restaurant_id='11111111-1111-1111-1111-111111111111' and status in ('pending_restaurant','accepted') order by created_at loop
      begin
        if r.status = 'pending_restaurant' then perform accept_order(r.id); end if;
        perform mark_ready_for_pickup(r.id);
        insert into bench_log(kind, order_id, ok) values ('ready', r.id, true);
      exception when others then insert into bench_log(kind, order_id, ok, err) values ('ready', r.id, false, sqlerrm); end;
      commit;
    end loop;
    perform pg_sleep(0.05); commit;
  end loop;
end $$;

-- courier: accept own live offer, then walk the active order to delivered
create or replace procedure bench_courier(p_user uuid, p_seconds int) language plpgsql as $$
declare v_end timestamptz := clock_timestamp() + make_interval(secs => p_seconds); v_cid uuid; v_offer uuid; v_oid uuid; v_st text; v_next text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated')::text, false);
  select id into v_cid from couriers where user_id = p_user;
  while clock_timestamp() < v_end loop
    select id, status into v_oid, v_st from orders where courier_id = v_cid and status in ('courier_assigned','picked_up','en_route') limit 1;
    if v_oid is not null then
      v_next := case v_st when 'courier_assigned' then 'picked_up' when 'picked_up' then 'en_route' else 'delivered' end;
      begin
        perform advance_delivery_status(v_oid, v_next, case when v_next='delivered' then true else null end);
        insert into bench_log(kind, actor, order_id, ok) values ('adv:'||v_next, v_cid, v_oid, true);
      exception when others then insert into bench_log(kind, actor, order_id, ok, err) values ('adv:'||v_next, v_cid, v_oid, false, sqlerrm); end;
    else
      select id into v_offer from dispatch_offers where courier_id = v_cid and status='offered' and expires_at > now() limit 1;
      if v_offer is not null then
        begin
          perform accept_dispatch_offer(v_offer);
          insert into bench_log(kind, actor, ok) values ('accept', v_cid, true);
        exception when others then insert into bench_log(kind, actor, ok, err) values ('accept', v_cid, false, sqlerrm); end;
      end if;
    end if;
    commit;
    perform pg_sleep(0.02 + random()*0.03); commit;
  end loop;
end $$;

-- sweeper in a tight loop (cron runs it every 15s; here every 200ms to maximise overlap)
create or replace procedure bench_sweeper(p_seconds int) language plpgsql as $$
declare v_end timestamptz := clock_timestamp() + make_interval(secs => p_seconds);
begin
  while clock_timestamp() < v_end loop
    begin perform expire_dispatch_offers(); insert into bench_log(kind, ok) values ('sweep', true);
    exception when others then insert into bench_log(kind, ok, err) values ('sweep', false, sqlerrm); end;
    commit; perform pg_sleep(0.2); commit;
  end loop;
end $$;

-- claim race: courier tries assign_courier on every order in a fixed order
create or replace procedure bench_claim_all(p_user uuid, p_orders uuid[]) language plpgsql as $$
declare o uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated')::text, false);
  foreach o in array p_orders loop
    begin perform assign_courier(o); insert into bench_log(kind, actor, order_id, ok) values ('claim', p_user, o, true);
    exception when others then insert into bench_log(kind, actor, order_id, ok, err) values ('claim', p_user, o, false, sqlerrm); end;
    commit;
  end loop;
end $$;
create or replace procedure bench_accept_at_boundary(p_user uuid) language plpgsql as $$
declare v_cid uuid; v_offer uuid; v_exp timestamptz; v_wait float;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated')::text, false);
  select id into v_cid from couriers where user_id = p_user;
  select id, expires_at into v_offer, v_exp from dispatch_offers where courier_id=v_cid and status='offered' limit 1;
  if v_offer is null then return; end if;
  v_wait := extract(epoch from v_exp - clock_timestamp()) + (random()-0.5)*0.06;  -- land within ±30ms of expiry
  if v_wait > 0 then perform pg_sleep(v_wait); end if;
  begin perform accept_dispatch_offer(v_offer); insert into bench_log(kind, actor, order_id, ok) values ('bacc', v_cid, (select order_id from dispatch_offers where id=v_offer), true);
  exception when others then insert into bench_log(kind, actor, order_id, ok, err) values ('bacc', v_cid, (select order_id from dispatch_offers where id=v_offer), false, sqlerrm); end;
  commit;
end $$;
create or replace procedure bench_sweeper_fast(p_ms int) language plpgsql as $$
declare v_end timestamptz := clock_timestamp() + make_interval(secs => p_ms/1000.0);
begin
  while clock_timestamp() < v_end loop
    begin perform expire_dispatch_offers(); exception when others then insert into bench_log(kind, ok, err) values ('sweep', false, sqlerrm); end;
    commit;
  end loop;
end $$;
