-- #8 guard sim. authenticated role so the trigger sees the real writer. BEGIN/ROLLBACK.
do $$
declare v_rid uuid := '11111111-1111-1111-1111-111111111111';
        v_active boolean; v_accepting boolean; v_slug text;
begin
  -- admin suspends the restaurant (platform moderation)
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  set local role authenticated;
  update public.restaurants set is_active = false where id = v_rid;
  reset role;
  select is_active into v_active from public.restaurants where id = v_rid;
  if v_active <> false then raise exception 'FAIL: admin could not suspend'; end if;

  -- partner tries to un-suspend themselves + change slug + toggle accepting_orders
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  set local role authenticated;
  update public.restaurants set is_active = true, slug = 'hacked-slug', accepting_orders = false where id = v_rid;
  reset role;
  select is_active, slug, accepting_orders into v_active, v_slug, v_accepting from public.restaurants where id = v_rid;
  if v_active <> false then raise exception 'FAIL: partner overturned suspension (is_active=%)', v_active; end if;
  if v_slug = 'hacked-slug' then raise exception 'FAIL: partner rewrote slug'; end if;
  if v_accepting <> false then raise exception 'FAIL: partner could not toggle accepting_orders (legit field)'; end if;
  raise notice 'PASS #8: partner cannot flip is_active/slug (reverted), CAN still toggle accepting_orders';

  -- admin re-activates (moderation restored)
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  set local role authenticated;
  update public.restaurants set is_active = true where id = v_rid;
  reset role;
  select is_active into v_active from public.restaurants where id = v_rid;
  if v_active <> true then raise exception 'FAIL: admin could not re-activate'; end if;
  raise notice 'PASS #8b: admin retains full moderation control over is_active';
end $$;
