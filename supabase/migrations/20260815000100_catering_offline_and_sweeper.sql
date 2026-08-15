-- Armata SPOF 2026-08-15, trei omisiuni în jurul plafonului de numerar.
--
-- (1) CRIT — catering exceptat la dispecerizare, dar NU la trecerea forțată
--     offline. Migrația 20260813000400 a scos comenzile catering-cash de sub
--     gate-ul din dispatch_order (9.000 MDL depășesc orice plafon prin
--     construcție), dar `enforce_cash_cap_offline` n-a primit aceeași excepție:
--     primul curier care livrează o comandă catering-cash e trecut offline
--     instant, cu tura închisă și ofertele live anulate. În DB există deja 4
--     comenzi catering-cash (medie 8.994 MDL); niciuna livrată încă — bug-ul nu
--     s-a declanșat din noroc, nu prin proiectare.
--     Distincția pe care o facem: offline forțat = PEDEAPSĂ (pentru numerar
--     standard acumulat peste plafon); blocarea ofertelor noi prin
--     courier_has_capacity = PROTECȚIE, și rămâne activă. Cu 9.000 MDL în
--     buzunar curierul chiar trebuie să treacă pe la sediu — dar își termină
--     tura, nu e dat afară din ea la mijlocul livrării.
--
-- (2) HIGH — trecerea offline pe plafon era complet MUTĂ. Ghost-offline-ul (3
--     oferte ratate) scrie în notification_outbox; ăsta nu scria nimic, deci
--     curierul rămânea offline fără să afle de ce.
--
-- (3) HIGH — buclele sweeper-ului prindeau doar unique_violation și
--     deadlock_detected în jurul lui dispatch_order. Orice altă excepție (ex.
--     query_canceled din statement_timeout, pe un lock ținut de o anulare
--     concurentă) omora TOT tick-ul, nu doar comanda problematică: restul
--     expirărilor și dispecerizărilor din acea rundă se pierdeau.

create or replace function public.enforce_cash_cap_offline()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_balance numeric;
  v_cap numeric;
  v_order_type text;
  v_user uuid;
begin
  -- Acumulările din catering nu trag curierul offline (vezi dispatch_order).
  if new.order_id is not null then
    select order_type into v_order_type from public.orders where id = new.order_id;
    if v_order_type = 'catering' then
      return new;
    end if;
  end if;

  v_balance := public.courier_cash_balance(new.courier_id);
  v_cap := public.effective_cash_cap(new.courier_id);
  if v_cap is not null and v_balance >= v_cap then
    update public.couriers set status = 'offline'
    where id = new.courier_id and status <> 'offline'
    returning user_id into v_user;

    update public.courier_shifts set ended_at = now()
    where courier_id = new.courier_id and ended_at is null;

    update public.dispatch_offers set status = 'declined', responded_at = now()
    where courier_id = new.courier_id and status = 'offered';

    -- Spune-i curierului DE CE — altfel rămâne offline fără explicație, exact
    -- ca la ghost-offline, care notifică de la 20260731000400 încoace.
    if v_user is not null then
      insert into public.notification_outbox (user_id, title, body, url, tag)
      values (
        v_user,
        'Plafon de numerar atins',
        format('Ai %s MDL nepredați, din plafonul de %s. Te-am trecut offline — predă încasările și revii online.',
               trim(to_char(v_balance, 'FM999999.99')), trim(to_char(v_cap, 'FM999999.99'))),
        '/deliveries',
        'cash'
      );
    end if;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.expire_dispatch_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
declare
  v_rec record;
  v_count int := 0;
  v_streak int;
  v_courier_user uuid;
begin
  for v_rec in
    with expired as (
      update public.dispatch_offers
      set status = 'expired', responded_at = now()
      where status = 'offered' and expires_at < now()
      returning order_id, courier_id
    ) select order_id, courier_id from expired
  loop
    update public.couriers
    set consecutive_ignored_offers = consecutive_ignored_offers + 1
    where id = v_rec.courier_id
    returning consecutive_ignored_offers into v_streak;

    if v_streak >= 3 then
      update public.courier_shifts set ended_at = now()
      where courier_id = v_rec.courier_id and ended_at is null;

      update public.dispatch_offers set status = 'declined', responded_at = now()
      where courier_id = v_rec.courier_id and status = 'offered';

      update public.couriers set status = 'offline', consecutive_ignored_offers = 0
      where id = v_rec.courier_id
      returning user_id into v_courier_user;

      if v_courier_user is not null then
        insert into public.notification_outbox (user_id, title, body, url, tag)
        values (
          v_courier_user,
          'Trecut offline automat',
          'Te-am trecut offline după 3 oferte ratate — revino online când ești gata.',
          '/deliveries',
          'dispatch'
        );
      end if;
    end if;

    begin
      perform public.dispatch_order(v_rec.order_id);
    exception when others then null;  -- o comanda problematica nu omoara tot tick-ul
    end;
    v_count := v_count + 1;
  end loop;

  for v_rec in
    select o.id as order_id from public.orders o
    where o.status = 'ready_for_pickup' and o.courier_id is null
      and not exists (select 1 from public.dispatch_offers d
                      where d.order_id = o.id and d.status = 'offered')
  loop
    begin
      perform public.dispatch_order(v_rec.order_id);
    exception when others then null;  -- o comanda problematica nu omoara tot tick-ul
    end;
  end loop;
  return v_count;
end;
$function$;
