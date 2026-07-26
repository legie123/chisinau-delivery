-- Master-audit §2.1 — versioned tariff + announced change. A rate change is a NEW
-- immutable version, syncs the active cache the money functions read, and notifies
-- every courier. Past versions can't be edited. Rolled back by runner.

do $$
declare
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_other uuid := 'a0000000-0000-0000-0000-000000000002'; -- courier, not admin
  v_cur record; v_new_id uuid; v_rows int; v_notes int; v_active int; v_raised boolean;
  v_ps_courier numeric;
begin
  -- current config = seeded v1 (15/20)
  select * into v_cur from public.current_pricing_config();
  if v_cur.courier_commission_pct <> 15 then raise exception 'FAIL: v1 courier pct % (expected 15)', v_cur.courier_commission_pct; end if;

  -- guard: a non-admin cannot change the tariff
  perform set_config('request.jwt.claims', json_build_object('sub', v_other,'role','authenticated')::text, true);
  v_raised := false;
  begin perform public.set_pricing_config(10, 18, now() + interval '1 day', 'hack'); exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: non-admin changed the tariff'; end if;

  -- admin appends a NEW version (courier 12%, effective tomorrow)
  select count(*) into v_active from public.couriers where is_active;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  v_new_id := public.set_pricing_config(12, 22, now() + interval '1 day', 'ajustare test');

  -- a new immutable row exists
  select count(*) into v_rows from public.pricing_config;
  if v_rows <> 2 then raise exception 'FAIL: expected 2 versions, got %', v_rows; end if;

  -- the active cache (platform_settings) is synced
  select courier_commission_pct into v_ps_courier from public.platform_settings;
  if v_ps_courier <> 12 then raise exception 'FAIL: platform_settings not synced (% )', v_ps_courier; end if;

  -- every active courier got an announcement
  select count(*) into v_notes from public.notification_outbox where tag = 'pricing' and title = 'Actualizare tarife';
  if v_notes < v_active or v_notes = 0 then raise exception 'FAIL: couriers not announced (% notes for % couriers)', v_notes, v_active; end if;

  -- a published version is IMMUTABLE
  v_raised := false;
  begin update public.pricing_config set courier_commission_pct = 1 where id = v_new_id; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a pricing version was editable'; end if;
  v_raised := false;
  begin delete from public.pricing_config where id = v_new_id; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a pricing version was deletable'; end if;

  raise notice 'PASS pricing-config: non-admin blocked; admin appended v2, cache synced, % couriers announced, versions immutable', v_notes;
end $$;
