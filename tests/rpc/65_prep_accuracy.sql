-- V2 buclă de noapte (2026-08-16) — „Precizie pregătire: -24.9 min" în panoul
-- partenerului. Minutele negative aveau DOUĂ cauze reale, nu una de afișare:
--
--   1. accept_order ștampila `estimated_ready_at = now() + prep` și pentru
--      comenzile PROGRAMATE, ignorând complet `requested_for`. În DB-ul viu,
--      CHD-2026-000470 (cerută pentru 12 aug 10:00) primise ținta 11 aug 20:23
--      — cu 13,6 ore înainte de fereastră. Bucătăria era anunțată să
--      gătească aseară, clientul vedea „gata în ~29 min", iar KPI-ul măsura
--      apoi diferența față de o promisiune care n-a existat niciodată.
--   2. restaurant_wait_kpis măsura precizia și pe comenzile cancelled/rejected,
--      deși CTE-ul de refuzuri din ACELAȘI view le excludea deja — o comandă
--      întreruptă n-a terminat niciun ciclu de bucătărie, deci evenimentul ei
--      de ready nu e semnal de finalizare.
--
-- Plus: media n-avea prag de eșantion. Ciocana Grill House afișa „+10017.6 min"
-- dintr-o singură comandă. Repo-ul are deja regula casei în get_prep_estimates
-- (orar≥5 → global≥5 → static): sub 5 observații nu se pretinde o statistică.
--
-- Rulat de runner în BEGIN/ROLLBACK.

do $$
declare
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003'; -- staff doar la Sakura
  v_customer uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid := '11111111-1111-1111-1111-111111111111'; -- Sakura Sushi
  v_order uuid;
  v_requested timestamptz;
  v_estimated timestamptz;
  v_drift_s numeric;
  v_avg numeric;
  v_count int;
  v_avg_after numeric;
  v_count_after int;
  i int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);

  -- ===== S1: comandă PROGRAMATĂ — ținta se ancorează de fereastră =====
  -- Ancora e `requested_for - 45 min`, exact pragul la care 20260811000000
  -- deschide dispecerizarea: momentul în care platforma însăși declară că
  -- începe partea de livrare. Deci bucătăria trebuie să fie gata atunci.
  v_requested := now() + interval '8 hours';
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, requested_for)
  values ('standard', v_customer, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 25, 225, v_requested)
  returning id into v_order;

  perform public.set_prep_time_estimate(v_order, 30);
  perform public.accept_order(v_order);
  select estimated_ready_at into v_estimated from public.orders where id = v_order;

  if v_estimated is null then raise exception 'FAIL S1: estimated_ready_at neștampilat'; end if;
  v_drift_s := abs(extract(epoch from (v_estimated - (v_requested - interval '45 minutes'))));
  if v_drift_s > 120 then
    raise exception 'FAIL S1: ținta % ignoră fereastra cerută % (ancora așteptată %, abatere % s) — bucătăria e anunțată la ora greșită',
      v_estimated, v_requested, v_requested - interval '45 minutes', round(v_drift_s);
  end if;
  raise notice 'PASS S1: comanda programată primește ținta ancorată de fereastră (%)', v_estimated;

  -- ===== S2: comandă ASAP — comportament NESCHIMBAT (gardă de regresie) =====
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_customer, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 25, 225)
  returning id into v_order;

  perform public.set_prep_time_estimate(v_order, 30);
  perform public.accept_order(v_order);
  select estimated_ready_at into v_estimated from public.orders where id = v_order;
  if abs(extract(epoch from (v_estimated - now())) - 30 * 60) > 120 then
    raise exception 'FAIL S2: comanda fără fereastră nu mai primește now()+prep (%)', v_estimated;
  end if;
  raise notice 'PASS S2: comanda ASAP păstrează ținta now()+prep';

  -- ===== S3: fereastră deja aproape — degradează onest la ASAP =====
  -- requested_for peste 20 min ⇒ ancora (requested_for-45) e în TRECUT; a o
  -- folosi ar însemna „ținta a expirat deja". greatest() alege now()+prep.
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, requested_for)
  values ('standard', v_customer, v_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 25, 225,
          now() + interval '20 minutes')
  returning id into v_order;

  perform public.set_prep_time_estimate(v_order, 30);
  perform public.accept_order(v_order);
  select estimated_ready_at into v_estimated from public.orders where id = v_order;
  if abs(extract(epoch from (v_estimated - now())) - 30 * 60) > 120 then
    raise exception 'FAIL S3: fereastra apropiată nu degradează la now()+prep (%)', v_estimated;
  end if;
  raise notice 'PASS S3: fereastra din următoarea oră degradează la ASAP, fără țintă în trecut';

  -- ===== Bază deterministă pentru KPI: neutralizez măsurătorile seed-uite =====
  -- (în tranzacție, dată înapoi de runner) — vreau un eșantion cunoscut, nu
  -- unul care depinde de câte comenzi are Sakura în DB-ul local azi.
  update public.orders set estimated_ready_at = null where restaurant_id = v_rest;

  -- exact 5 comenzi curate, fiecare cu +2 min întârziere ⇒ media trebuie să fie 2.0
  for i in 1..5 loop
    insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method,
                               payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, estimated_ready_at)
    values ('standard', v_customer, v_rest, 'delivered', 'cash', 'paid', 200, 25, 225,
            now() - interval '60 minutes')
    returning id into v_order;
    insert into public.delivery_status_events (order_id, status, actor_role, created_at)
    values (v_order, 'ready_for_pickup', 'restaurant_partner', now() - interval '58 minutes');
  end loop;

  select prep_accuracy_avg_minutes, prep_accuracy_orders into v_avg, v_count
  from public.restaurant_wait_kpis where restaurant_id = v_rest;

  if v_count <> 5 then raise exception 'FAIL S4 (bază): eșantion % în loc de 5', v_count; end if;
  if v_avg <> 2.0 then raise exception 'FAIL S4 (bază): media % în loc de 2.0', v_avg; end if;

  -- ===== S4: o comandă ANULATĂ nu mai otrăvește media =====
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method,
                             payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, estimated_ready_at)
  values ('standard', v_customer, v_rest, 'cancelled', 'cash', 'unpaid', 200, 25, 225,
          now() - interval '10 hours')
  returning id into v_order;
  insert into public.delivery_status_events (order_id, status, actor_role, created_at)
  values (v_order, 'ready_for_pickup', 'restaurant_partner', now());

  select prep_accuracy_avg_minutes, prep_accuracy_orders into v_avg_after, v_count_after
  from public.restaurant_wait_kpis where restaurant_id = v_rest;

  if v_count_after <> 5 or v_avg_after <> 2.0 then
    raise exception 'FAIL S4: o comandă cancelled (+600 min) a intrat în precizie — media %/% în loc de 2.0/5',
      v_avg_after, v_count_after;
  end if;
  raise notice 'PASS S4: comanda anulată e exclusă din precizie, ca în CTE-ul de refuzuri al aceluiași view';

  -- ===== S5: sub 5 observații nu se pretinde o statistică =====
  update public.orders set estimated_ready_at = null
  where id = (select id from public.orders
              where restaurant_id = v_rest and estimated_ready_at is not null and status = 'delivered'
              limit 1);

  select prep_accuracy_avg_minutes, prep_accuracy_orders into v_avg_after, v_count_after
  from public.restaurant_wait_kpis where restaurant_id = v_rest;

  if v_count_after <> 4 then raise exception 'FAIL S5: eșantion % în loc de 4', v_count_after; end if;
  if v_avg_after is not null then
    raise exception 'FAIL S5: media % raportată din doar 4 comenzi (regula casei din get_prep_estimates: ≥5)',
      v_avg_after;
  end if;
  raise notice 'PASS S5: sub prag media e NULL, iar numărul de comenzi rămâne vizibil (%)', v_count_after;
end $$;
