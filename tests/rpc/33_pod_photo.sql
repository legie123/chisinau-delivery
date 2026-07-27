-- Directive 12 (web pilot, mobile excluded) — POD PHOTO for cash orders.
-- Sims: wrong courier raises; status guard (only en_route/delivered);
-- overwrite allowed while en_route AND within 1h of delivered_at, blocked
-- past that window; invalid path (wrong order prefix) rejected; purge_expired_pii
-- deletes a >90-day storage.objects row in 'delivery-proof' and nulls any
-- orders.pod_photo_path left dangling by that delete, while a recent row
-- survives. Rolled back by runner.

do $$
declare
  v_ion_user uuid := 'c0000000-0000-0000-0000-000000000004';   -- Ion Bulgaru, assigned to order 4
  v_wrong_user uuid := 'c0000000-0000-0000-0000-000000000002'; -- Nicolae Bejan, a courier but NOT assigned to order 4
  v_ion_courier uuid;
  v_order4 uuid := 'e0000000-0000-0000-0000-000000000004';
  v_order6 uuid := 'e0000000-0000-0000-0000-000000000006';
  v_raised boolean;
  v_path text;
  v_old_id uuid;
  v_recent_id uuid;
begin
  select id into v_ion_courier from public.couriers where user_id = v_ion_user;

  -- ==== 0. baseline: order 4 assigned to Ion, en_route, no proof yet ====
  update public.orders
  set status = 'en_route', courier_id = v_ion_courier, delivered_at = null, pod_photo_path = null
  where id = v_order4;

  -- ==== 1. a courier NOT assigned to the order cannot attach proof ====
  perform set_config('request.jwt.claims', json_build_object('sub', v_wrong_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.attach_delivery_proof(v_order4, v_order4::text || '/hack.jpg');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a non-assigned courier attached a delivery proof'; end if;

  select pod_photo_path into v_path from public.orders where id = v_order4;
  if v_path is not null then raise exception 'FAIL: the blocked call still wrote a path'; end if;

  -- ==== 2. status guard: not allowed before en_route ====
  update public.orders set status = 'courier_assigned' where id = v_order4;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ion_user,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.attach_delivery_proof(v_order4, v_order4::text || '/too-early.jpg');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: attach_delivery_proof allowed before en_route'; end if;

  -- ==== 3. invalid path (wrong order prefix) is rejected even for the assigned courier ====
  update public.orders set status = 'en_route' where id = v_order4;
  v_raised := false;
  begin perform public.attach_delivery_proof(v_order4, v_order6::text || '/cross-order.jpg');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a path scoped to a different order was accepted'; end if;

  -- ==== 4. the assigned courier attaches proof while en_route — succeeds ====
  perform public.attach_delivery_proof(v_order4, v_order4::text || '/enroute.jpg');
  select pod_photo_path into v_path from public.orders where id = v_order4;
  if v_path is distinct from v_order4::text || '/enroute.jpg' then
    raise exception 'FAIL: pod_photo_path = % (expected the en_route upload)', v_path;
  end if;

  -- ==== 5. overwrite allowed while still en_route (retake) ====
  perform public.attach_delivery_proof(v_order4, v_order4::text || '/enroute-retake.jpg');
  select pod_photo_path into v_path from public.orders where id = v_order4;
  if v_path is distinct from v_order4::text || '/enroute-retake.jpg' then
    raise exception 'FAIL: overwrite while en_route did not stick';
  end if;

  -- ==== 6. delivered, fresh delivered_at — overwrite still allowed within 1h ====
  update public.orders set status = 'delivered', delivered_at = now() - interval '10 minutes' where id = v_order4;
  perform public.attach_delivery_proof(v_order4, v_order4::text || '/delivered-fresh.jpg');
  select pod_photo_path into v_path from public.orders where id = v_order4;
  if v_path is distinct from v_order4::text || '/delivered-fresh.jpg' then
    raise exception 'FAIL: overwrite within the 1h delivered window did not stick';
  end if;

  -- ==== 7. delivered more than 1h ago — window enforced, overwrite blocked ====
  update public.orders set delivered_at = now() - interval '2 hours' where id = v_order4;
  v_raised := false;
  begin perform public.attach_delivery_proof(v_order4, v_order4::text || '/too-late.jpg');
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: attach_delivery_proof succeeded past the 1h delivered window'; end if;

  select pod_photo_path into v_path from public.orders where id = v_order4;
  if v_path is distinct from v_order4::text || '/delivered-fresh.jpg' then
    raise exception 'FAIL: the blocked late overwrite still changed pod_photo_path (got %)', v_path;
  end if;

  -- ==== 8. purge: >90-day storage.objects row deleted, recent one survives,
  --         and a dangling orders.pod_photo_path is nulled out ====
  insert into storage.objects (id, bucket_id, name, created_at)
  values (gen_random_uuid(), 'delivery-proof', v_order4::text || '/delivered-fresh.jpg', now() - interval '100 days')
  returning id into v_old_id;
  insert into storage.objects (id, bucket_id, name, created_at)
  values (gen_random_uuid(), 'delivery-proof', v_order4::text || '/keep-me.jpg', now())
  returning id into v_recent_id;

  perform public.purge_expired_pii();

  if exists (select 1 from storage.objects where id = v_old_id) then
    raise exception 'FAIL: purge_expired_pii kept a delivery-proof object older than 90 days';
  end if;
  if not exists (select 1 from storage.objects where id = v_recent_id) then
    raise exception 'FAIL: purge_expired_pii deleted a recent delivery-proof object';
  end if;

  select pod_photo_path into v_path from public.orders where id = v_order4;
  if v_path is not null then
    raise exception 'FAIL: purge_expired_pii left pod_photo_path=% dangling after its backing object was deleted', v_path;
  end if;

  raise notice 'PASS pod-photo: wrong courier blocked, status guard (en_route/delivered only), cross-order path rejected, overwrite allowed while en_route and within 1h of delivered_at, blocked past that window, purge removes >90-day delivery-proof objects and nulls a dangling pod_photo_path while keeping recent objects';
end $$;
