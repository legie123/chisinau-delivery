-- 113: CLIENT red-team round 3 (migration 20261012000111). Seven defects on delete_my_account,
-- order_complaints and place_order. Every block is red when its fix is reverted.
-- 113.1 banned_until finite (GoTrue 500s on 'infinity'); a legacy infinity ban is repaired by the scrub
-- 113.2 the extra personal data is gone: rating comment, own complaint text, catering/venue contacts,
--       pending onboarding -> rejected + scrubbed, outbox, one-time tokens, auth audit rows
-- 113.3 a future venue booking blocks the deletion like an order in flight
-- 113.4 a JWT issued before the deletion can no longer order, add an address or edit the profile
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_o uuid; v_cat uuid; v_vb uuid; v_addr uuid; v_item uuid; v_qty int; r record;
begin
  for r in select * from (values (v_uid, 'sim113@test.md'), (v_legacy, 'sim113-legacy@test.md')) t(id, email) loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values (r.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', r.email, 'x', now(),
            '{"full_name":"Ion Sim"}', '', 'rec-' || r.id::text, '', '');
    insert into public.profiles (id, role, full_name, phone) values (r.id, 'customer', 'Ion Sim', '+37369000113')
    on conflict (id) do update set role = 'customer', full_name = 'Ion Sim';
  end loop;
  insert into public.addresses (customer_id, street_address, contact_phone, lat, lng)
  values (v_uid, 'Str. Ion 1', '+37369000113', 47.025, 28.833) returning id into v_addr;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_uid, v_rest, 'delivered', 'cash', 'paid', 100, 20, 120) returning id into v_o;
  insert into public.ratings (order_id, customer_id, target_type, restaurant_id, stars, comment)
  values (v_o, v_uid, 'restaurant', v_rest, 2, 'Ion aici, sunați-mă la 069000113');
  insert into public.order_complaints (order_id, kind, note, created_by) values (v_o, 'other', 'Eu, Ion, tel 069000113', v_uid);
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('catering', v_uid, v_rest, 'delivered', 'cash', 'paid', 3000, 0, 3000) returning id into v_cat;
  insert into public.catering_details (order_id, event_date, guest_count, event_address_text, contact_person, contact_phone)
  values (v_cat, current_date - 1, 30, 'Str. Ion 1, ap. 7', 'Ion Sim', '+37369000113');
  insert into public.venue_bookings (venue_id, customer_id, starts_at, ends_at, party_size, purpose, status, notes, contact_person, contact_phone)
  values (v_rest, v_uid, now() + interval '2 days', now() + interval '2 days 2 hours', 6, 'dining', 'confirmed', 'ziua lui Ion', 'Ion Sim', '+37369000113')
  returning id into v_vb;
  insert into public.onboarding_applications (user_id, applicant_type, status, full_name, phone, email, details)
  values (v_uid, 'courier', 'pending', 'Ion Sim', '+37369000113', 'sim113@test.md', '{"idnp":"2000000000113"}');
  insert into public.notification_outbox (user_id, title, body) values (v_uid, 'Comandă livrată', 'Poftă bună, Ion');
  insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to)
  values (gen_random_uuid(), v_uid, 'recovery_token', 'h113', 'sim113@test.md');
  insert into auth.audit_log_entries (instance_id, id, payload, created_at, ip_address)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), jsonb_build_object('actor_id', v_uid::text, 'actor_username', 'sim113@test.md', 'action', 'login'), now(), '');

  -- 113.3 the future booking blocks
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_my_account();
    raise exception 'FAIL 113.3: deleted with a confirmed booking in two days';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%rezervare în curs%' then raise exception 'FAIL 113.3: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  update public.venue_bookings set status = 'cancelled' where id = v_vb;
  raise notice 'PASS 113.3: a future venue booking blocks the deletion';

  -- 113.1 + 113.2 delete
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform public.delete_my_account();
  perform set_config('request.jwt.claims', null, true);
  select (select banned_until from auth.users where id = v_uid) as banned,
         (select recovery_token from auth.users where id = v_uid) as rec,
         (select count(*) from public.ratings where customer_id = v_uid and comment is not null) as rating_comments,
         (select note from public.order_complaints where order_id = v_o) as complaint,
         (select contact_person || contact_phone || event_address_text from public.catering_details where order_id = v_cat) as catering,
         (select contact_person || contact_phone || coalesce(notes, '') from public.venue_bookings where id = v_vb) as venue,
         (select status || full_name || phone || coalesce(email, '') || details::text from public.onboarding_applications where user_id = v_uid) as onboarding,
         (select count(*) from public.notification_outbox where user_id = v_uid) as outbox,
         (select count(*) from auth.one_time_tokens where user_id = v_uid) as ott,
         (select count(*) from auth.audit_log_entries where payload ->> 'actor_id' = v_uid::text) as audit
    into r;
  if r.banned is null or r.banned = 'infinity' or r.banned < now() + interval '100 years' then
    raise exception 'FAIL 113.1: banned_until must be finite and far away, got %', r.banned;
  end if;
  raise notice 'PASS 113.1: banned_until finite (%)', r.banned;
  if r.rec <> '' or r.rating_comments <> 0 or r.complaint like '%Ion%' or r.catering like '%Ion%' or r.catering like '%113%'
     or r.venue like '%Ion%' or r.onboarding not like 'rejected%' or r.onboarding like '%Ion%' or r.onboarding like '%113%'
     or r.outbox <> 0 or r.ott <> 0 or r.audit <> 0 then
    raise exception 'FAIL 113.2: personal data left: %', r;
  end if;
  raise notice 'PASS 113.2: rating comment, complaint text, catering/venue contacts, onboarding, outbox, tokens, audit rows scrubbed';

  -- 113.1b a legacy 'infinity' ban is repaired by the scrub (the migration re-scrubs them)
  update auth.users set banned_until = 'infinity', email = 'sters-' || v_legacy::text || '@deleted.invalid' where id = v_legacy;
  perform public.scrub_deleted_customer(v_legacy);
  if (select banned_until from auth.users where id = v_legacy) = 'infinity' then
    raise exception 'FAIL 113.1b: legacy infinity ban not repaired';
  end if;
  if has_function_privilege('authenticated', 'public.scrub_deleted_customer(uuid)', 'execute') then
    raise exception 'FAIL 113.1b: scrub_deleted_customer callable by authenticated';
  end if;
  raise notice 'PASS 113.1b: legacy infinity ban repaired; scrub is internal';

  -- 113.4 the old JWT: no order, no address, no profile edit
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  select mi.id, greatest(1, ceil(rr.min_order_amount_mdl / mi.price_mdl))::int into v_item, v_qty
  from public.menu_items mi join public.restaurants rr on rr.id = mi.restaurant_id
  where mi.restaurant_id = v_rest and mi.is_available and not mi.is_catering_only order by mi.price_mdl limit 1;
  for r in select * from (values ('place_order'), ('address'), ('profile')) t(what) loop
    begin
      if r.what = 'place_order' then
        perform public.place_order(v_rest, 'standard', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', v_qty)), v_addr);
      elsif r.what = 'address' then
        insert into public.addresses (customer_id, street_address, lat, lng) values (v_uid, 'Str. Ion 2', 47.02, 28.83);
      else
        update public.profiles set full_name = 'Ion e înapoi' where id = v_uid;
      end if;
      raise exception 'FAIL 113.4: % allowed after the deletion', r.what;
    exception when raise_exception then
      if sqlerrm like 'FAIL%' then raise; end if;
      if sqlerrm not like 'Contul a fost șters%' then raise exception 'FAIL 113.4: % wrong refusal: %', r.what, sqlerrm; end if;
    end;
  end loop;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 113.4: a deleted account cannot order, add an address or edit the profile';
end $$;

-- 113.5 customer_report_problem: a never-accepted cancelled order is refused; max 3 per order
-- 113.7 the ops alert carries no customer text; the webhook body neutralizes < > @ and disables mentions
do $$
declare
  c_cust constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_never uuid; v_acc uuid; v_c uuid; v_msg text; v_body jsonb; v_url text := 'http://127.0.0.1:9/sim113';
begin
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, 'cancelled', 'cash', 'unpaid', 100, 20, 120) returning id into v_never;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, v_rest, 'cancelled', 'cash', 'unpaid', 100, 20, 120) returning id into v_acc;
  update public.orders set notes = 'sim113-acc' where id = v_acc;
  insert into public.delivery_status_events (order_id, status, actor_role) values (v_acc, 'accepted', 'restaurant_partner');
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.customer_report_problem(v_never, 'late', 'Nimeni n-a venit');
    raise exception 'FAIL 113.5: a complaint on a never-accepted cancelled order';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%n-a fost acceptată%' then raise exception 'FAIL 113.5: wrong refusal: %', sqlerrm; end if;
  end;
  -- cancelled AFTER acceptance: allowed (the kitchen started, something went wrong)
  v_c := public.customer_report_problem(v_acc, 'other', '<!channel> @everyone <http://evil.md|click> Ion');
  -- 113.7 no customer text in the alert
  select message into v_msg from public.ops_alerts where kind = 'customer_complaint' and ref_id = v_c;
  if v_msg is null or v_msg like '%channel%' or v_msg like '%everyone%' or v_msg like '%evil%' or v_msg like '%Ion%' then
    raise exception 'FAIL 113.7: customer text in the ops alert: %', v_msg;
  end if;
  -- the webhook body (pg_net queue, never sent: the url is a dead port) neutralizes the markup anyway
  perform set_config('app.ops_alert_webhook_url', v_url, true);
  update public.ops_alerts set message = 'Test <!channel> @everyone <http://x|y>' where kind = 'customer_complaint' and ref_id = v_c;
  perform public.scan_ops_alerts();
  select convert_from(body, 'utf8')::jsonb into v_body from net.http_request_queue where url = v_url order by id desc limit 1;
  if v_body is null then raise exception 'FAIL 113.7: no webhook request queued'; end if;
  if v_body ->> 'content' like '%<%' or v_body ->> 'content' like '%>%' or v_body ->> 'content' like '%@%'
     or v_body -> 'allowed_mentions' -> 'parse' is distinct from '[]'::jsonb then
    raise exception 'FAIL 113.7: webhook body not neutralized: %', v_body;
  end if;
  perform set_config('app.ops_alert_webhook_url', '', true);
  delete from net.http_request_queue where url = v_url;
  raise notice 'PASS 113.7: alert without customer text; webhook body neutralized, mentions off';

  -- cap: three complaints (resolved) then the fourth is refused
  perform set_config('request.jwt.claims', null, true);
  update public.order_complaints set status = 'resolved', resolved_at = now(), resolution = 'test' where id = v_c;
  insert into public.order_complaints (order_id, kind, note, created_by, status, resolved_at, resolution)
  values (v_acc, 'late', 'a doua', c_cust, 'resolved', now(), 'test'), (v_acc, 'late', 'a treia', c_cust, 'resolved', now(), 'test');
  perform set_config('request.jwt.claims', json_build_object('sub', c_cust, 'role', 'authenticated')::text, true);
  begin
    perform public.customer_report_problem(v_acc, 'quality', 'a patra');
    raise exception 'FAIL 113.5: a fourth complaint on the same order';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%de mai multe ori%' then raise exception 'FAIL 113.5: wrong cap refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 113.5: never-accepted cancelled refused; cancelled after acceptance ok; max 3 per order';
end $$;

-- 113.6 the customer reads NO complaint row (ops notes/resolutions are internal); only the status of
-- the latest one on their own order, through my_order_complaint_status; nothing on a stranger's order.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_own uuid; v_other uuid; v_n int;
begin
  select o.id into v_own from public.orders o where o.customer_id = 'a0000000-0000-0000-0000-000000000001' and o.notes = 'sim113-acc';
  select count(*) into v_n from public.order_complaints;
  if v_n <> 0 then raise exception 'FAIL 113.6: the customer reads % complaint rows', v_n; end if;
  if public.my_order_complaint_status(v_own) is distinct from 'resolved' then
    raise exception 'FAIL 113.6: own status = %', public.my_order_complaint_status(v_own);
  end if;
  raise notice 'PASS 113.6: no complaint rows for the customer; own latest status via RPC';
end $$;
reset role;
do $$
declare v_other uuid;
begin
  select o.id into v_other from public.orders o where o.customer_id <> 'a0000000-0000-0000-0000-000000000001'
    and exists (select 1 from public.order_complaints oc where oc.order_id = o.id) limit 1;
  if v_other is null then
    insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
    values ('standard', 'b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'delivered', 'cash', 'paid', 100, 20, 120) returning id into v_other;
    insert into public.order_complaints (order_id, kind, note) values (v_other, 'other', 'altcineva');
  end if;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  if public.my_order_complaint_status(v_other) is not null then
    raise exception 'FAIL 113.6: status of a stranger''s complaint visible';
  end if;
  perform set_config('request.jwt.claims', null, true);
  if has_function_privilege('anon', 'public.my_order_complaint_status(uuid)', 'execute') then
    raise exception 'FAIL 113.6: anon can call my_order_complaint_status';
  end if;
  raise notice 'PASS 113.6: nothing on a stranger''s order; anon locked out';
end $$;

-- 113.8 request fingerprint: the same options in another order are the SAME request (retry = same order)
do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_item uuid; v_grp uuid; v_o1 uuid; v_o2 uuid; v_addr uuid; v_o uuid; v_again uuid; v_price numeric; v_qty int;
begin
  delete from public.restaurant_hours where restaurant_id = v_rest;
  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select v_rest, d, '00:00'::time, '00:00'::time, false from generate_series(0,6) d;
  update public.restaurants set accepting_orders = true, is_active = true where id = v_rest;
  select coalesce(min_order_amount_mdl, 0) into v_price from public.restaurants where id = v_rest;
  insert into public.menu_items (restaurant_id, name, price_mdl, is_available) values (v_rest, 'Sim 113 cu opțiuni', greatest(v_price, 10), true) returning id into v_item;
  insert into public.menu_option_groups (menu_item_id, name, is_required, min_select, max_select) values (v_item, 'Extra', false, 0, 2) returning id into v_grp;
  insert into public.menu_options (group_id, name, price_delta_mdl) values (v_grp, 'Susan', 5) returning id into v_o1;
  insert into public.menu_options (group_id, name, price_delta_mdl) values (v_grp, 'Wasabi', 5) returning id into v_o2;
  insert into public.addresses (customer_id, street_address, lat, lng) values (v_cust, 'sim113', 47.025, 28.833) returning id into v_addr;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  v_o := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
           p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1, 'option_ids', jsonb_build_array(v_o1, v_o2))),
           p_delivery_address_id => v_addr, p_idempotency_key => 'sim113-opt');
  v_again := public.place_order(p_restaurant_id => v_rest, p_order_type => 'standard', p_payment_method => 'cash',
           p_items => jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1, 'option_ids', jsonb_build_array(v_o2, v_o1))),
           p_delivery_address_id => v_addr, p_idempotency_key => 'sim113-opt');
  perform set_config('request.jwt.claims', null, true);
  if v_again is distinct from v_o then raise exception 'FAIL 113.8: options in another order = another request'; end if;
  raise notice 'PASS 113.8: option order does not change the fingerprint';
end $$;
