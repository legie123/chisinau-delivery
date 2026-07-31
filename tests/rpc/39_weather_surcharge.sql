-- Faza 5 #3 — suprataxa de vreme (20260731000200): versionată + anunțată,
-- stampată la cotare (podea, fără surge retroactiv), în transparența publică,
-- măsurată în KPI-ul de buget. Rolled back de runner.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_item uuid; v_addr uuid; v_oid uuid;
  v_quote numeric; v_surch numeric; v_base numeric; v_perkm numeric; n int;
begin
  -- admin pornește o suprataxă de 7 MDL (versiune nouă, anunțată)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  -- now() e înghețat per-tranzacție: effective_from explicit ordonat, altfel
  -- ambele versiuni de test au același timestamp și "latest" devine ambiguu
  perform public.set_courier_tariff(30, 6, 1.5, 3, now() - interval '1 minute', 'test vreme', 7);
  select weather_surcharge_mdl, base_mdl, per_km_mdl into v_surch, v_base, v_perkm
    from public.current_courier_tariff();
  if v_surch <> 7 then raise exception 'FAIL: suprataxa activă % (așteptat 7)', v_surch; end if;
  select count(*) into n from public.notification_outbox
    where tag = 'pricing' and body like '%suprataxă vreme 7 MDL%';
  if n = 0 then raise exception 'FAIL: anunțul de suprataxă lipsește din outbox'; end if;

  -- comandă → accept → ready: cota include suprataxa + componenta stampată
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '23:59'::time, false from generate_series(0,6) d;
  update public.restaurants set min_order_amount_mdl = 0 where id = v_rest;
  select id into v_item from public.menu_items where restaurant_id = v_rest and is_available and not is_catering_only limit 1;
  select id into v_addr from public.addresses where customer_id = v_cust limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust,'role','authenticated')::text, true);
  v_oid := public.place_order(v_rest, 'standard', 'cash',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1)), v_addr, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner,'role','authenticated')::text, true);
  perform public.accept_order(v_oid);
  perform public.mark_ready_for_pickup(v_oid);

  select courier_fee_quoted_mdl, courier_fee_surcharge_mdl into v_quote, v_surch
    from public.orders where id = v_oid;
  if v_surch <> 7 then raise exception 'FAIL: componenta stampată % (așteptat 7)', v_surch; end if;
  if v_quote < v_base + 7 then
    raise exception 'FAIL: cota % nu include baza+suprataxa (>= %)', v_quote, v_base + 7;
  end if;

  -- transparența publică include coloana (apelabil ca anon)
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  select count(*) into n from public.public_courier_tariff_history() h where h.weather_surcharge_mdl = 7;
  if n = 0 then raise exception 'FAIL: istoricul public nu arată suprataxa'; end if;

  -- oprirea: versiune nouă cu 0 — comenzile viitoare fără suprataxă; cea stampată rămâne
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.set_courier_tariff(30, 6, 1.5, 3, now(), 'test vreme off', 0);
  select weather_surcharge_mdl into v_surch from public.current_courier_tariff();
  if v_surch <> 0 then raise exception 'FAIL: suprataxa nu s-a oprit'; end if;
  select courier_fee_surcharge_mdl into v_surch from public.orders where id = v_oid;
  if v_surch <> 7 then raise exception 'FAIL: componenta stampată s-a pierdut la oprire'; end if;

  -- KPI #6 rulează (admin) și întoarce un rând de buget
  select count(*) into n from public.admin_pilot_go_no_go() g where g.kpi like 'Buget%';
  if n <> 1 then raise exception 'FAIL: KPI buget lipsă din go/no-go'; end if;

  raise notice 'PASS weather-surcharge: versionat+anunțat, stampat la cotare (podea), public în istoric, off nu pierde stamparea, KPI viu';
end $$;
