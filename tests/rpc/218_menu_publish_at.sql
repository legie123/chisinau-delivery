-- Scheduled publish (migration 20261013000315_menu_publish_at): menu_items.publish_at +
-- publish_scheduled_menu_items() on pg_cron every minute: a hidden item with a photo whose
-- publish_at has passed becomes available (publish_at cleared); no photo → stays hidden
-- (same gate as toggleItemAvailability); future → untouched. Fails before: column/function missing.
do $$
declare
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  c_photo text := 'https://x.supabase.co/storage/v1/object/public/restaurant-photos/11111111-1111-1111-1111-111111111111/sim218.jpg';
  v_due uuid; v_nophoto uuid; v_future uuid; v_n int; v_avail boolean; v_at timestamptz; v_err text;
begin
  insert into public.menu_items (restaurant_id, name, price_mdl, is_available, photo_url, publish_at)
  values (c_rest, 'Sim 218 due', 10, false, c_photo, now() - interval '1 minute') returning id into v_due;
  insert into public.menu_items (restaurant_id, name, price_mdl, is_available, photo_url, publish_at)
  values (c_rest, 'Sim 218 no photo', 10, false, null, now() - interval '1 minute') returning id into v_nophoto;
  insert into public.menu_items (restaurant_id, name, price_mdl, is_available, photo_url, publish_at)
  values (c_rest, 'Sim 218 future', 10, false, c_photo, now() + interval '1 day') returning id into v_future;

  v_n := public.publish_scheduled_menu_items();
  if v_n <> 1 then raise exception 'FAIL 218.0: expected 1 published, got %', v_n; end if;

  select is_available, publish_at into v_avail, v_at from public.menu_items where id = v_due;
  if not v_avail or v_at is not null then raise exception 'FAIL 218.1: due item not published (% / %)', v_avail, v_at; end if;
  raise notice 'PASS 218.1: due item with photo published, publish_at cleared';

  select is_available into v_avail from public.menu_items where id = v_nophoto;
  if v_avail then raise exception 'FAIL 218.2: item without photo was published'; end if;
  raise notice 'PASS 218.2: no photo stays hidden';

  select is_available, publish_at into v_avail, v_at from public.menu_items where id = v_future;
  if v_avail or v_at is null then raise exception 'FAIL 218.3: future item touched'; end if;
  raise notice 'PASS 218.3: future stays hidden';

  -- rerun is idempotent
  if public.publish_scheduled_menu_items() <> 0 then raise exception 'FAIL 218.4: rerun published again'; end if;
  raise notice 'PASS 218.4: idempotent';

  select count(*) into v_n from cron.job where jobname = 'publish-scheduled-menu-items';
  if v_n <> 1 then raise exception 'FAIL 218.5: cron job missing'; end if;
  raise notice 'PASS 218.5: cron job scheduled';

  set local role anon;
  v_err := null;
  begin
    perform public.publish_scheduled_menu_items();
  exception when insufficient_privilege then v_err := sqlerrm; end;
  reset role;
  if v_err is null then raise exception 'FAIL 218.6: anon can execute publish_scheduled_menu_items'; end if;
  raise notice 'PASS 218.6: anon refused';
end $$;
