-- Sim 66 (R9) — durata de livrare de pe suprafata ADMIN: mediana judecata,
-- esantionul publicat, media pastrata.
--
-- Ce a fost masurat inainte de fix, pe DB-ul viu: sase livrari in fereastra de
-- 7 zile, cu duratele placed→delivered
--   10130,2 · 7071,7 · 15,1 · 7,2 · 5,4 · 0,0  (minute)
-- View-ul publica DOAR media (2871,6), iar `admin_pilot_go_no_go` o compara cu
-- „≤35–49 min" si scria FAIL pe pagina de decizie a pilotului. Mediana
-- acelorasi randuri e 11,15 → PASS. Doua verdicte opuse din aceleasi date.
--
-- Simul ruleaza pe date PROPRII, intr-o tranzactie rulata inapoi: DB-ul local e
-- partajat de mai multi muncitori ai buclei si se misca sub masuratoare (fapt
-- constatat in timpul acestui val — doua comenzi si-au schimbat `delivered_at`
-- intre doua interogari la trei minute distanta).
begin;

set local role postgres;

-- Un admin propriu, ca `has_role('platform_admin')` sa fie adevarat pentru noi.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('9a000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'sim66-admin@test.md', crypt('parola123', gen_salt('bf')),
        now(), now(), now(), '', '', '', '');
insert into profiles (id, full_name, role) values ('9a000000-0000-0000-0000-0000000000aa', 'Sim66 Admin', 'platform_admin')
on conflict (id) do update set role = 'platform_admin';

-- Fereastra curata: scoatem din calcul livrarile preexistente ale seed-ului,
-- ca simul sa masoare EXACT randurile lui (altfel alt muncitor le poate muta).
update orders set delivered_at = now() - interval '90 days'
where status = 'delivered' and delivered_at >= now() - interval '7 days';

set local role authenticated;
set local request.jwt.claims = '{"sub":"9a000000-0000-0000-0000-0000000000aa","role":"authenticated"}';

-- S1 — sub pragul casei (4 livrari) nu se da niciun verdict.
set local role postgres;
insert into orders (id, order_number, customer_id, restaurant_id, status, order_type,
                    payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl,
                    created_at, delivered_at)
select gen_random_uuid(), 'SIM66-' || g, p.id, r.id, 'delivered', 'standard',
       'cash', 'paid', 100, 40, 140,
       now() - interval '2 days' - (g || ' minutes')::interval,
       now() - interval '2 days'
from generate_series(1, 4) g
cross join lateral (select id from profiles where role = 'customer' limit 1) p
cross join lateral (select id from restaurants limit 1) r;

set local role authenticated;
set local request.jwt.claims = '{"sub":"9a000000-0000-0000-0000-0000000000aa","role":"authenticated"}';
do $$
declare v_status text; v_value text; v_n bigint;
begin
  select total_delivery_orders into v_n from admin_dispatch_metrics limit 1;
  if v_n <> 4 then raise exception 'S1 esantion: astept 4, primesc %', v_n; end if;
  select status, value_text into v_status, v_value from admin_pilot_go_no_go() where kpi = 'Timp total livrare (7d)';
  if v_status <> 'no_data' then raise exception 'S1: sub prag verdictul trebuie sa fie no_data, e %', v_status; end if;
  if v_value not like '%4 livrări%' then raise exception 'S1: celula trebuie sa spuna cate livrari, e %', v_value; end if;
  raise notice 'S1 OK — 4 livrari, no_data, celula: %', v_value;
end $$;

-- S2 — la prag, cu o coada lunga: mediana judeca, media ramane scrisa.
-- Patru livrari de 1..4 minute + una de 7 zile ⇒ mediana 3 min (PASS),
-- media ~2019 min (ar fi dat FAIL). Exact forma datelor vii.
set local role postgres;
insert into orders (id, order_number, customer_id, restaurant_id, status, order_type,
                    payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl,
                    created_at, delivered_at)
select gen_random_uuid(), 'SIM66-LONG', p.id, r.id, 'delivered', 'standard',
       'cash', 'paid', 100, 40, 140,
       now() - interval '9 days', now() - interval '2 days'
from (select id from profiles where role = 'customer' limit 1) p,
     (select id from restaurants limit 1) r;
-- duratele celor 4 scurte: 1, 2, 3, 4 minute
update orders set created_at = delivered_at - ((substring(order_number from 'SIM66-(\d)')::int) || ' minutes')::interval
where order_number like 'SIM66-_' and order_number <> 'SIM66-LONG';

set local role authenticated;
set local request.jwt.claims = '{"sub":"9a000000-0000-0000-0000-0000000000aa","role":"authenticated"}';
do $$
declare v_med numeric; v_avg numeric; v_n bigint; v_status text; v_value text;
begin
  select total_delivery_median_minutes, total_delivery_avg_minutes, total_delivery_orders
    into v_med, v_avg, v_n from admin_dispatch_metrics limit 1;
  if v_n <> 5 then raise exception 'S2 esantion: astept 5, primesc %', v_n; end if;
  if v_med > 10 then raise exception 'S2 mediana: astept ~3 min, primesc %', v_med; end if;
  if v_avg < 1000 then raise exception 'S2 media trebuie sa RAMANA publicata si mare (coada), e %', v_avg; end if;
  select status, value_text into v_status, v_value from admin_pilot_go_no_go() where kpi = 'Timp total livrare (7d)';
  if v_status <> 'pass' then raise exception 'S2: mediana de 3 min trebuie sa treaca tinta ≤49, verdict %', v_status; end if;
  if v_value not like '%median%' or v_value not like '%5 livrări%' or v_value not like '%media%' then
    raise exception 'S2: celula trebuie sa spuna mediana + esantion + media, e %', v_value;
  end if;
  raise notice 'S2 OK — mediana % / media % pe % livrari; celula: %', v_med, v_avg, v_n, v_value;
end $$;

-- S3 — poarta de admin ramane intacta: un non-admin nu vede randuri.
set local role postgres;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('9a000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'sim66-client@test.md', crypt('parola123', gen_salt('bf')),
        now(), now(), now(), '', '', '', '');
insert into profiles (id, full_name, role) values ('9a000000-0000-0000-0000-0000000000bb', 'Sim66 Client', 'customer')
on conflict (id) do update set role = 'customer';

set local role authenticated;
set local request.jwt.claims = '{"sub":"9a000000-0000-0000-0000-0000000000bb","role":"authenticated"}';
do $$
declare v_rows int;
begin
  select count(*) into v_rows from admin_dispatch_metrics;
  if v_rows <> 0 then raise exception 'S3: non-adminul vede % randuri din admin_dispatch_metrics', v_rows; end if;
  begin
    perform admin_pilot_go_no_go();
    raise exception 'S3: non-adminul a putut rula admin_pilot_go_no_go()';
  exception when others then null;
  end;
  raise notice 'S3 OK — poarta de admin tine pe view si pe functie';
end $$;

rollback;
