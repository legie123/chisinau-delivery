-- OPERATIONAL: restaurant onboarding end-to-end — the critical path for taking on
-- a real restaurant. self-signup applicant submits an application -> admin approves
-- -> restaurant created (inactive) + staff linked + default hours seeded + partner
-- role set -> admin activates -> restaurant is live and orderable. Runner wraps in
-- BEGIN/ROLLBACK (postgres superuser; auth via jwt claims).

do $$
declare
  v_applicant uuid := 'a0000000-0000-0000-0000-000000000001'; -- a plain user (becomes the partner)
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_app uuid; v_rid uuid; v_role text; v_active boolean; v_accepting boolean;
  v_staff int; v_hours int; v_access boolean;
begin
  -- 1. applicant submits a restaurant onboarding application (as themselves).
  perform set_config('request.jwt.claims', json_build_object('sub', v_applicant, 'role','authenticated')::text, true);
  v_app := public.submit_onboarding_application(
    'restaurant', 'Ovidiu Proprietar', '+37360000099', 'ovidiu@nou.md',
    jsonb_build_object('name','Trattoria Nouă','cuisine_type','fine_dining','address','str. Testului 1','sector','Centru',
                       'delivery_fee_mdl', 45, 'min_order_amount_mdl', 150, 'avg_prep_minutes', 30));
  if v_app is null then raise exception 'FAIL: submit returned null'; end if;

  -- optional KYC doc attach (proves the storage-path RPC is callable by the applicant)
  perform public.add_kyc_document(v_app, 'id_card', v_applicant::text || '/buletin.jpg');

  -- 2. admin approves -> restaurant + staff + hours + role.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform public.review_onboarding_application(v_app, true, 'ok');

  select id, is_active, accepting_orders into v_rid, v_active, v_accepting
    from public.restaurants where slug like 'trattoria-nou%' order by created_at desc limit 1;
  if v_rid is null then raise exception 'FAIL: no restaurant created on approval'; end if;
  if v_active then raise exception 'FAIL: restaurant should land INACTIVE (admin activates)'; end if;

  select role into v_role from public.profiles where id = v_applicant;
  if v_role <> 'restaurant_partner' then raise exception 'FAIL: applicant role = % (expected restaurant_partner)', v_role; end if;

  select count(*) into v_staff from public.restaurant_staff where user_id = v_applicant and restaurant_id = v_rid;
  if v_staff <> 1 then raise exception 'FAIL: staff link not created (% rows)', v_staff; end if;

  select count(*) into v_hours from public.restaurant_hours where restaurant_id = v_rid;
  if v_hours <> 7 then raise exception 'FAIL: default weekly hours not seeded (% rows)', v_hours; end if;

  -- 3. partner can now access their restaurant (has_restaurant_access).
  perform set_config('request.jwt.claims', json_build_object('sub', v_applicant, 'role','authenticated')::text, true);
  select public.has_restaurant_access(v_rid) into v_access;
  if not v_access then raise exception 'FAIL: partner has no access to their restaurant'; end if;

  -- 4. admin activates -> restaurant is live (orderable).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  update public.restaurants set is_active = true, accepting_orders = true where id = v_rid;
  select is_active into v_active from public.restaurants where id = v_rid;
  if not v_active then raise exception 'FAIL: activation did not stick'; end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS onboarding-e2e: submit -> approve (restaurant % inactive + staff + 7 hours + partner role) -> access -> activate. Ready to receive orders.', v_rid;
end $$;
