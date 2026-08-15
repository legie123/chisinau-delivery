-- Concierge — ciclul rezervării unei locații (2026-08-15).
-- S1: clientul cere o rezervare; personalul locației e anunțat.
-- S2: doar personalul locației poate face ofertă (un străin e respins).
-- S3: clientul confirmă doar o rezervare care ARE ofertă.
-- S4: refuzul cere motiv, iar motivul ajunge la client.
-- S5: RLS — un alt client nu vede rezervarea (probele sub `set local role`,
--     altfel superuserul ocolește politicile și aserțiunea trece fals).

do $$
declare
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_other_cust uuid := 'b0000000-0000-0000-0000-000000000002';
  v_partner uuid := 'a0000000-0000-0000-0000-000000000003';   -- staff Sakura
  v_venue uuid := '11111111-1111-1111-1111-111111111111';     -- Sakura
  v_booking uuid;
  v_status text;
  v_price numeric;
  v_notices int;
  v_rows int;
  v_raised boolean;
begin
  -- Verific premisa fixture-ului: partenerul chiar are acces la locație.
  if not exists (select 1 from public.restaurant_staff where restaurant_id = v_venue and user_id = v_partner) then
    raise exception 'FIXTURE: user-ul % nu e staff la locația %', v_partner, v_venue;
  end if;

  update public.restaurants set venue_type = 'business_lounge' where id = v_venue;
  delete from public.notification_outbox where tag like 'booking:%';

  -- ===== S1: cererea =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  v_booking := public.request_venue_booking(
    v_venue, now() + interval '3 days', now() + interval '3 days 2 hours',
    8, 'meeting', 'Andrei', '+37360000001', 'Ședință de brainstorming');

  select status into v_status from public.venue_bookings where id = v_booking;
  if v_status <> 'requested' then
    raise exception 'FAIL S1: starea inițială e %, așteptat requested', v_status;
  end if;
  select count(*) into v_notices from public.notification_outbox
  where tag = 'booking:' || v_booking and user_id = v_partner;
  if v_notices = 0 then
    raise exception 'FAIL S1: personalul locației nu a fost anunțat de cerere';
  end if;
  raise notice 'PASS S1: cererea e înregistrată și personalul e anunțat';

  -- ===== S2: doar personalul locației poate oferta =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_cust, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin perform public.quote_venue_booking(v_booking, 1200);
  exception when others then v_raised := true; end;
  if not v_raised then
    raise exception 'FAIL S2: un utilizator străin a putut pune preț pe rezervare';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  perform public.quote_venue_booking(v_booking, 1200);
  select status, quoted_price_mdl into v_status, v_price from public.venue_bookings where id = v_booking;
  if v_status <> 'quoted' or v_price <> 1200 then
    raise exception 'FAIL S2: oferta partenerului nu s-a aplicat (stare %, preț %)', v_status, v_price;
  end if;
  raise notice 'PASS S2: doar personalul locației poate oferta (1200 MDL)';

  -- ===== S3: confirmarea aparține clientului =====
  v_raised := false;
  begin perform public.confirm_venue_booking(v_booking);  -- încă sub identitatea partenerului
  exception when others then v_raised := true; end;
  if not v_raised then
    raise exception 'FAIL S3: partenerul a confirmat în locul clientului';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  perform public.confirm_venue_booking(v_booking);
  select status into v_status from public.venue_bookings where id = v_booking;
  if v_status <> 'confirmed' then
    raise exception 'FAIL S3: rezervarea nu s-a confirmat (stare %)', v_status;
  end if;
  raise notice 'PASS S3: clientul confirmă, partenerul nu poate confirma în locul lui';

  -- ===== S4: refuzul cere motiv și îl transmite =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  declare v_b2 uuid;
  begin
    v_b2 := public.request_venue_booking(
      v_venue, now() + interval '5 days', now() + interval '5 days 1 hour',
      4, 'wellness', 'Ana', '+37360000002', null);

    perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
    v_raised := false;
    begin perform public.decline_venue_booking(v_b2, '   ');
    exception when others then v_raised := true; end;
    if not v_raised then raise exception 'FAIL S4: refuzul a trecut fără motiv'; end if;

    perform public.decline_venue_booking(v_b2, 'Sala e ocupată la ora aceea');
    select count(*) into v_notices from public.notification_outbox
    where tag = 'booking:' || v_b2 and user_id = v_cust and body = 'Sala e ocupată la ora aceea';
    if v_notices = 0 then
      raise exception 'FAIL S4: clientul nu a primit motivul refuzului';
    end if;
    raise notice 'PASS S4: refuzul cere motiv și clientul îl primește';
  end;

  -- ===== S5: RLS — rezervarea nu se vede de străini =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_cust, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.venue_bookings where id = v_booking;
  if v_rows <> 0 then
    raise exception 'FAIL S5: un alt client vede rezervarea (scurgere RLS)';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.venue_bookings where id = v_booking;
  if v_rows <> 1 then
    raise exception 'FAIL S5: proprietarul nu-și vede propria rezervare';
  end if;
  reset role;
  raise notice 'PASS S5: rezervarea e vizibilă doar clientului ei (și locației)';

  perform set_config('request.jwt.claims', null, true);
end $$;
