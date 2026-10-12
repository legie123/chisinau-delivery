-- 108: a note per dish ("fără wasabi") reaches the kitchen ticket (C2, migration 20261012000105).
-- order_items.notes existed and KitchenTicket renders it, but place_order never wrote it. Now each
-- p_items element may carry "notes": trimmed, empty -> NULL, longer than 140 characters refused with
-- a Romanian message (nothing written).
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_qty int; v_addr uuid; v_o uuid; v_notes text[];
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true where id = v_rest;
  select mi.id, greatest(1, ceil(r.min_order_amount_mdl / mi.price_mdl))::int into v_item, v_qty
  from public.menu_items mi join public.restaurants r on r.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only
    and (mi.sold_out_until is null or mi.sold_out_until <= now())
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
  order by mi.price_mdl limit 1;
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng)
  values (v_cust, 'sim108', '+37360000000', 47.0250, 28.8330) returning id into v_addr;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  -- 108.1 two lines of the same dish, one with a note, one with a blank note
  v_o := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
           p_items => jsonb_build_array(
             jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty, 'notes', '  fără wasabi  '),
             jsonb_build_object('menu_item_id', v_item, 'quantity', 1, 'notes', '   ')),
           p_delivery_address_id => v_addr, p_idempotency_key => 'sim108-a');
  select array_agg(coalesce(notes, '<null>') order by quantity desc) into v_notes from public.order_items where order_id = v_o;
  if v_notes is distinct from array['fără wasabi', '<null>'] then
    raise exception 'FAIL 108.1: item notes stored as %, expected {fără wasabi,<null>}', v_notes;
  end if;
  raise notice 'PASS 108.1: per-dish note stored trimmed, blank -> NULL';

  -- 108.2 a note over 140 characters is refused, nothing written
  begin
    perform public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
              p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty, 'notes', repeat('x', 141))),
              p_delivery_address_id => v_addr, p_idempotency_key => 'sim108-long');
    raise exception 'FAIL 108.2: a 141-character note was accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'nota pentru%' then raise exception 'FAIL 108.2: wrong refusal: %', sqlerrm; end if;
  end;
  if exists (select 1 from public.orders where idempotency_key = 'sim108-long') then raise exception 'FAIL 108.2: row left'; end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 108.2: over-long note refused';
end $$;
