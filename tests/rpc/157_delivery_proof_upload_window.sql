-- Proof-of-delivery uploads only inside attach_delivery_proof's window (migration 20261012000207).
-- Before: the storage insert policy checked only the assignment, so uploads in courier_assigned / picked_up /
-- cancelled / days after delivery succeeded and attach_delivery_proof then refused them: orphan objects. Also the
-- bucket had no size cap and no MIME list.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_addr uuid; v_a uuid; v_ua uuid; v_b uuid; v_ub uuid; v_o uuid; v_st text; v_ok boolean;
  v_limit bigint; v_mimes text[];
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.addresses (customer_id, street_address) values (c_cust, 'Str. Sim 157') returning id into v_addr;
  select id, user_id into v_a, v_ua from public.couriers where is_active order by id limit 1;
  select id, user_id into v_b, v_ub from public.couriers where is_active and id <> v_a order by id limit 1;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, courier_id)
  values ('standard', c_cust, v_rest, v_addr, 'courier_assigned', 'cash', 'unpaid', 200, 30, 230, v_a) returning id into v_o;

  foreach v_st in array array['courier_assigned', 'picked_up', 'en_route', 'delivered_recent', 'delivered_90min', 'delivered_old', 'cancelled'] loop
    update public.orders set
      status = case when v_st like 'delivered%' then 'delivered' else v_st end,
      delivered_at = case v_st when 'delivered_recent' then now() - interval '10 minutes'
                               when 'delivered_90min' then now() - interval '90 minutes'
                               when 'delivered_old' then now() - interval '3 days' else null end
    where id = v_o;
    perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into storage.objects (bucket_id, name) values ('delivery-proof', v_o || '/' || v_st || '.jpg');
      v_ok := true;
    exception when insufficient_privilege then v_ok := false;
    end;
    reset role;
    if v_ok is distinct from (v_st in ('en_route', 'delivered_recent')) then
      raise exception 'FAIL 157.W1: upload at % allowed=% (expected only en_route and <= 1 h after delivery)', v_st, v_ok;
    end if;
  end loop;
  raise notice 'PASS 157.W1: upload allowed only en_route and <= 1 h after delivery (refused at courier_assigned, picked_up, 3 days later, cancelled)';

  -- another courier, even en_route, cannot upload into this order's folder
  update public.orders set status = 'en_route', delivered_at = null where id = v_o;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name) values ('delivery-proof', v_o || '/foreign.jpg');
    v_ok := true;
  exception when insufficient_privilege then v_ok := false;
  end;
  reset role;
  if v_ok then raise exception 'FAIL 157.W2: another courier uploaded into this order''s folder'; end if;
  raise notice 'PASS 157.W2: another courier refused';

  select file_size_limit, allowed_mime_types into v_limit, v_mimes from storage.buckets where id = 'delivery-proof';
  if v_limit is distinct from 10485760 or v_mimes is distinct from array['image/jpeg', 'image/png', 'image/webp'] then
    raise exception 'FAIL 157.W3: bucket limit=% mimes=%', v_limit, v_mimes;
  end if;
  raise notice 'PASS 157.W3: bucket capped at 10 MiB, images only';
end $$;
