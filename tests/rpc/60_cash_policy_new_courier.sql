-- Plafonul „curier nou" devine configurabil (2026-08-15). Simularea pilotului
-- a arătat că regimul de probă e frâna operațională #1 la lansare (toți curierii
-- sunt noi), deci reglarea lui trebuie să fie o decizie de business, nu o migrație.
-- S1: implicit, comportamentul de dinainte se păstrează (curier nou → 1000).
-- S2: o versiune nouă de politică cu new_courier_days = 0 ridică TOATĂ flota la cap_mdl.
-- S3: un plafon de probă explicit (ex. 1300) se aplică prin least() cu cap_mdl.
-- S4: efectul se vede în dispatch — o comandă cash care era blocată devine ofertabilă.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid;
  v_cap numeric;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;
  -- Curier „nou" prin construcție (fixture-ul seed poate fi vechi în DB-ul viu).
  update public.couriers set created_at = now() - interval '3 days' where id = v_courier;
  -- courier_has_capacity (S4) cade și pe o livrare ÎN CURS, nu doar pe plafon —
  -- eliberează curierul, altfel aserțiunea de numerar măsoară altceva.
  update public.orders set status = 'delivered', delivered_at = coalesce(delivered_at, now())
  where courier_id = v_courier and status in ('courier_assigned', 'picked_up', 'en_route');

  -- ===== S1: implicit = comportamentul hardcodat de dinainte =====
  v_cap := public.effective_cash_cap(v_courier);
  if v_cap <> 1000 then
    raise exception 'FAIL S1: plafonul implicit pentru curier nou e %, așteptat 1000', v_cap;
  end if;
  raise notice 'PASS S1: implicit, curierul nou rămâne pe 1000 MDL';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- ===== S2: fără perioadă de probă → plafonul plin =====
  perform public.set_cash_policy(1500, 500, 'Predă la sediu', now() - interval '1 minute',
                                 'sim 60 — fără probă', 1000, 0);
  v_cap := public.effective_cash_cap(v_courier);
  if v_cap <> 1500 then
    raise exception 'FAIL S2: cu new_courier_days=0 plafonul e %, așteptat 1500', v_cap;
  end if;
  raise notice 'PASS S2: new_courier_days=0 ridică toată flota la plafonul plin';

  -- ===== S3: plafon de probă explicit, aplicat prin least() =====
  perform public.set_cash_policy(1500, 500, 'Predă la sediu', now(),
                                 'sim 60 — probă 1300', 1300, 30);
  v_cap := public.effective_cash_cap(v_courier);
  if v_cap <> 1300 then
    raise exception 'FAIL S3: plafonul de probă configurat e %, așteptat 1300', v_cap;
  end if;
  raise notice 'PASS S3: plafonul de probă configurabil se aplică (1300)';

  -- ===== S4: efect real în dispatch =====
  -- Balanță 1100: peste vechiul plafon de probă (1000) → curierul era invizibil
  -- pentru orice comandă; sub cel configurat acum (1300) → redevine candidat.
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  select v_courier, 'refund_reversal', -public.courier_cash_balance(v_courier), 'sim 60 baseline'
  where public.courier_cash_balance(v_courier) <> 0;
  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note)
  values (v_courier, 'collected', 1100, 'sim 60 — float peste vechiul plafon de probă');

  if not public.courier_has_capacity(v_courier) then
    raise exception 'FAIL S4: curierul e blocat la 1100 MDL deși plafonul configurat e 1300';
  end if;
  raise notice 'PASS S4: la 1100 MDL curierul rămâne disponibil sub plafonul configurat';

  perform set_config('request.jwt.claims', null, true);
end $$;

-- S5/S6: starea de numerar trebuie să raporteze plafonul EFECTIV al curierului,
-- nu pe cel din politică — altfel curierul nou vede un plafon mai mare decât
-- cel după care e judecat de dispatch.
do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_courier_user uuid := 'a0000000-0000-0000-0000-000000000002';
  v_courier uuid;
  v_shown numeric;
  v_effective numeric;
begin
  select id into v_courier from public.couriers where user_id = v_courier_user;
  update public.couriers set created_at = now() - interval '3 days' where id = v_courier;
  v_effective := public.effective_cash_cap(v_courier);

  perform set_config('request.jwt.claims', json_build_object('sub', v_courier_user, 'role', 'authenticated')::text, true);
  select cap_mdl into v_shown from public.get_courier_cash_status();
  if v_shown <> v_effective then
    raise exception 'FAIL S5: curierul vede plafonul %, dar dispatch-ul îl judecă după %', v_shown, v_effective;
  end if;
  raise notice 'PASS S5: curierul vede exact plafonul după care e judecat (%)', v_shown;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select cap_mdl into v_shown from public.admin_courier_cash_status(v_courier);
  if v_shown <> v_effective then
    raise exception 'FAIL S6: adminul vede plafonul %, efectiv %', v_shown, v_effective;
  end if;
  raise notice 'PASS S6: adminul vede același plafon efectiv (%)', v_shown;

  perform set_config('request.jwt.claims', null, true);
end $$;
