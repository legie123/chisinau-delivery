-- REPRO (CLIENT→RESTAURANT, 2026-10-12): the customer confirms a catering quote it was shown, but
-- confirm_catering_quote(p_order_id) takes no amount, and submit_catering_quote may re-quote while
-- quoted. Expected after the fix: confirm with the shown amount refuses when the quote changed.
-- Run: docker exec -i supabase_db_chisinau-delivery psql -U postgres < docs/handoff/repro/catering-quote-confirm.sql
-- Today prints: RESULT shown_quote=3500.00 confirmed_total=9000.00 no_error  (rolled back)
BEGIN;
do $$ declare rid uuid; mid uuid; p numeric; q int; o uuid; tot numeric; shown numeric;
begin
  select id into rid from public.restaurants where name = 'Sakura Sushi';
  update public.restaurants set accepting_orders = true where id = rid;
  select mi.id, mi.price_mdl into mid, p from public.menu_items mi where mi.restaurant_id = rid and mi.is_available
    and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = mi.id and g.is_required)
    and (mi.sold_out_until is null or mi.sold_out_until <= now()) order by mi.price_mdl desc limit 1;
  q := ceil(3000 / p)::int + 1;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  o := public.place_order(rid, 'catering', 'cash', jsonb_build_array(jsonb_build_object('menu_item_id', mid, 'quantity', q)), null,
         now() + interval '10 days', null,
         jsonb_build_object('event_date', (now() + interval '10 days')::date, 'event_time', '18:00', 'guest_count', 20,
                            'event_address_text', 'redteam sim', 'contact_person', 'X', 'contact_phone', '060000000'),
         'K-REDTEAM-CAT', 1);
  raise notice 'placed catering with p_expected_total=1, subtotal %', (select subtotal_mdl from public.orders where id = o);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
  perform public.submit_catering_quote(o, 3500);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  select quoted_total_mdl into shown from public.catering_details where order_id = o;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
  perform public.submit_catering_quote(o, 9000);
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  perform public.confirm_catering_quote(o);
  select total_mdl into tot from public.orders where id = o;
  raise notice 'RESULT shown_quote=% confirmed_total=% no_error', shown, tot;
end $$;
ROLLBACK;
