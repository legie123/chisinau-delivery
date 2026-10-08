-- Address integrity (migration 20261008000400_address_in_flight_lock).
-- orders.delivery_address_id points at the LIVE addresses row (no snapshot): the
-- courier navigates to it and advance_delivery_status recomputes the courier fee from
-- its lat/lng at handover. Before the fix the owner could rewrite street/pin of an
-- address while an order to it was in flight (addresses_owner_update) — the courier
-- was redirected mid-delivery and the fee repriced. After: the location columns are
-- frozen while any order to the address is not delivered/cancelled/rejected; contact
-- columns (phone, intercom, notes, label, default) stay editable.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid; v_addr uuid; v_oid uuid; v_err text; v_street text;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;
  insert into public.addresses (customer_id, street_address, lat, lng, contact_phone)
  values (c_cust, 'Str. Sim 87', 47.02, 28.83, '069000087') returning id into v_addr;
  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, v_addr, 'en_route', 'cash', 'unpaid', 200, 30, 230)
  returning id into v_oid;

  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);

  -- ===== L1: street change on an in-flight address -> refused (Romanian) =====
  v_err := null;
  set local role authenticated;
  begin
    update public.addresses set street_address = 'Str. Alta 1' where id = v_addr;
  exception when others then v_err := sqlerrm; end;
  reset role;
  select street_address into v_street from public.addresses where id = v_addr;
  if v_err is null or v_street <> 'Str. Sim 87' then
    raise exception 'FAIL 87.L1: street rewritten to "%" while an order to it is en_route', v_street;
  end if;
  if v_err not like '%comandă în curs%' then raise exception 'FAIL 87.L1: unexpected refusal: %', v_err; end if;
  raise notice 'PASS 87.L1: in-flight street change refused (%)', v_err;

  -- ===== L2: pin move refused too (fee + navigation source) =====
  v_err := null;
  set local role authenticated;
  begin
    update public.addresses set lat = 47.05 where id = v_addr;
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err is null then raise exception 'FAIL 87.L2: pin moved while in flight'; end if;
  raise notice 'PASS 87.L2: in-flight pin move refused';

  -- ===== L3: contact / cosmetic columns stay editable =====
  set local role authenticated;
  update public.addresses set contact_phone = '069111087', intercom_code = '12', notes = 'sună', label = 'Acasă',
                              is_default = true where id = v_addr;
  reset role;
  if (select contact_phone from public.addresses where id = v_addr) <> '069111087' then
    raise exception 'FAIL 87.L3: contact phone edit blocked';
  end if;
  raise notice 'PASS 87.L3: phone / intercom / notes / label / default still editable';

  -- ===== L4: once the order is final the address is editable again =====
  update public.orders set status = 'cancelled' where id = v_oid;
  set local role authenticated;
  update public.addresses set street_address = 'Str. Alta 1' where id = v_addr;
  reset role;
  if (select street_address from public.addresses where id = v_addr) <> 'Str. Alta 1' then
    raise exception 'FAIL 87.L4: address still locked after the order ended';
  end if;
  raise notice 'PASS 87.L4: final order -> editable again';
end $$;
