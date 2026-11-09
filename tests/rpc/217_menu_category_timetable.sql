-- Category timetable (migration 20261013000314_menu_category_timetable):
-- menu_categories.available_from / available_until (both null = always) +
-- menu_category_available_at(category, at) in Europe/Chisinau local time, overnight
-- windows (from > until) wrap past midnight. Fails before: function does not exist.
do $$
declare
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_day uuid; v_night uuid; v_always uuid; v_err text;
  -- a fixed Chisinau day, so the asserts do not depend on when the sim runs
  c_base timestamptz := '2026-06-15 00:00'::timestamp at time zone 'Europe/Chisinau';
begin
  insert into public.menu_categories (restaurant_id, name, sort_order, available_from, available_until)
  values (c_rest, 'Sim 217 Mic dejun', 991, '07:00', '11:00') returning id into v_day;
  insert into public.menu_categories (restaurant_id, name, sort_order, available_from, available_until)
  values (c_rest, 'Sim 217 Noapte', 992, '22:00', '02:00') returning id into v_night;
  insert into public.menu_categories (restaurant_id, name, sort_order)
  values (c_rest, 'Sim 217 Oricând', 993) returning id into v_always;

  if not public.menu_category_available_at(v_day, c_base + interval '9 hours') then raise exception 'FAIL 217.1: 09:00 inside 07-11 → false'; end if;
  if public.menu_category_available_at(v_day, c_base + interval '13 hours') then raise exception 'FAIL 217.2: 13:00 outside 07-11 → true'; end if;
  if public.menu_category_available_at(v_day, c_base + interval '11 hours') then raise exception 'FAIL 217.2b: until is exclusive'; end if;
  raise notice 'PASS 217.1-2: day window inside/outside';

  if not public.menu_category_available_at(v_always, c_base + interval '3 hours') then raise exception 'FAIL 217.3: null window must be true'; end if;
  raise notice 'PASS 217.3: null window = always';

  if not public.menu_category_available_at(v_night, c_base + interval '23 hours 30 minutes') then raise exception 'FAIL 217.4: 23:30 inside 22-02 → false'; end if;
  if not public.menu_category_available_at(v_night, c_base + interval '1 hour') then raise exception 'FAIL 217.4b: 01:00 inside 22-02 → false'; end if;
  if public.menu_category_available_at(v_night, c_base + interval '12 hours') then raise exception 'FAIL 217.4c: 12:00 outside 22-02 → true'; end if;
  raise notice 'PASS 217.4: overnight window wraps midnight';

  -- half-set window refused by the check constraint
  v_err := null;
  begin
    update public.menu_categories set available_until = null where id = v_day;
  exception when check_violation then v_err := sqlerrm; end;
  if v_err is null then raise exception 'FAIL 217.5: from without until accepted'; end if;
  raise notice 'PASS 217.5: both-or-none check (%)', v_err;

  -- anon cannot execute the helper
  set local role anon;
  v_err := null;
  begin
    perform public.menu_category_available_at(v_day, now());
  exception when insufficient_privilege then v_err := sqlerrm; end;
  reset role;
  if v_err is null then raise exception 'FAIL 217.6: anon can execute menu_category_available_at'; end if;
  raise notice 'PASS 217.6: anon refused';
end $$;
