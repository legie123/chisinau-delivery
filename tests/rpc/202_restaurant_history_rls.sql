-- Order history on the tablet (/restaurant/orders/history) reads finished orders of
-- the last 30 days straight from `orders` under RLS. Guard: a partner of ANOTHER
-- restaurant sees none of Sakura's finished orders, the own partner sees all of
-- them, and neither query exposes rows of a restaurant the caller doesn't staff.
-- Rolled back by runner.
do $$
declare
  c_partner uuid := 'a0000000-0000-0000-0000-000000000003'; -- Sakura (+2 venues)
  c_other uuid := 'a0000000-0000-0000-0000-0000000002f2';   -- created here, Nobu only
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  c_foreign uuid := 'd0000000-0000-0000-0000-000000000003';
  v_expected int; v_n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values (c_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'sim202@test.md', '', now(), '', '', '', '');
  insert into public.profiles (id, role, full_name) values (c_other, 'restaurant_partner', 'Sim 202')
    on conflict (id) do update set role = 'restaurant_partner';
  insert into public.restaurant_staff (restaurant_id, user_id) values (c_foreign, c_other);

  select count(*) into v_expected from public.orders
   where restaurant_id = c_rest and status in ('delivered','cancelled','rejected')
     and created_at >= now() - interval '30 days';
  if v_expected = 0 then raise exception 'H0: seed has no finished Sakura orders — sim proves nothing'; end if;

  -- H1: the other venue's partner sees zero Sakura history rows
  perform set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.orders
   where restaurant_id = c_rest and status in ('delivered','cancelled','rejected');
  if v_n <> 0 then raise exception 'H1: foreign partner sees % Sakura rows', v_n; end if;
  -- and everything they do see belongs to their venue
  select count(*) into v_n from public.orders where restaurant_id <> c_foreign;
  if v_n <> 0 then raise exception 'H1b: foreign partner sees % rows of other venues', v_n; end if;

  -- H2: Sakura's partner sees all of them
  perform set_config('request.jwt.claims', json_build_object('sub', c_partner, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.orders
   where restaurant_id = c_rest and status in ('delivered','cancelled','rejected')
     and created_at >= now() - interval '30 days';
  if v_n <> v_expected then raise exception 'H2: own partner sees % of % rows', v_n, v_expected; end if;

  raise notice 'restaurant history RLS H1-H2 OK (% rows)', v_expected;
end $$;
