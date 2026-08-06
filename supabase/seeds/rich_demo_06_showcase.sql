-- Showcase demo data (RestClientAudit #5): the browse polish — numeric rating
-- tier + colour dot (rating_count>=3), the "Top" badge (rating_avg>=4.7 AND
-- count>=10), the free-delivery badge (delivery_fee=0), and item modifiers —
-- was invisible on a fresh reset because every seed restaurant sat under the
-- thresholds. This adds REAL ratings tied to fixture delivered orders (so the
-- browse badge AND the detail rating_breakdown stay consistent — breakdown is
-- all-time, no window), one free-delivery restaurant, and modifiers beyond
-- Sakura. Fixture orders are dated 60-90 days back so they fall OUTSIDE every
-- KPI/payout window the RPC sims use (7d/14d/28d/current-month) — no ripple.

do $$
declare
  v_rest uuid; v_cust uuid; v_oid uuid; i int; cust_ids uuid[]; v_stars int;
begin
  select array_agg(id order by id) into cust_ids from public.profiles where role = 'customer';

  -- Flagship "Top" (avg>=4.7, count>=10): 12 five-star delivered orders for Nobu.
  select id into v_rest from public.restaurants where slug = 'nobu-chisinau';
  if v_rest is not null then
    for i in 1..12 loop
      v_cust := cust_ids[1 + (i % array_length(cust_ids, 1))];
      insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
      values ('standard', v_cust, v_rest, 'delivered', 'cash', 'paid', 300, 70, 370, now() - ((60 + i) || ' days')::interval)
      returning id into v_oid;
      insert into public.ratings (order_id, customer_id, target_type, restaurant_id, stars, comment)
      values (v_oid, v_cust, 'restaurant', v_rest, 5, case when i = 1 then 'Omakase impecabil, servire premium.' else null end);
    end loop;
  end if;

  -- Two more over the numeric-tier threshold (count>=3), mixed 4/5 stars.
  for v_rest in select id from public.restaurants where slug in ('osaka-house', 'osteria-roma') loop
    for i in 1..4 loop
      v_cust := cust_ids[1 + (i % array_length(cust_ids, 1))];
      v_stars := case when i = 4 then 4 else 5 end;
      insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, delivered_at)
      values ('standard', v_cust, v_rest, 'delivered', 'cash', 'paid', 250, 45, 295, now() - ((70 + i) || ' days')::interval)
      returning id into v_oid;
      insert into public.ratings (order_id, customer_id, target_type, restaurant_id, stars, comment)
      values (v_oid, v_cust, 'restaurant', v_rest, v_stars, case when i = 1 then 'Foarte bun, recomand.' else null end);
    end loop;
  end loop;

  -- Recompute the denormalized rating columns from the actual ratings rows, so
  -- browse (denorm) and the detail breakdown (rows) agree everywhere.
  update public.restaurants r set rating_avg = s.avg, rating_count = s.cnt
  from (
    select restaurant_id, round(avg(stars), 2) as avg, count(*) as cnt
    from public.ratings where target_type = 'restaurant' group by restaurant_id
  ) s
  where s.restaurant_id = r.id;

  -- One free-delivery showcase restaurant (badge + a genuine promo config).
  update public.restaurants set delivery_fee_mdl = 0 where slug = 'amber-bistro';

  -- Modifiers beyond Sakura: a required size group on the first item of two more
  -- restaurants, so personalization is demoable across the catalogue.
  for v_rest in select id from public.restaurants where slug in ('nobu-chisinau', 'osaka-house') loop
    select mi.id into v_oid from public.menu_items mi
      where mi.restaurant_id = v_rest order by mi.sort_order, mi.name limit 1;
    if v_oid is not null and not exists (select 1 from public.menu_option_groups g where g.menu_item_id = v_oid) then
      insert into public.menu_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
      values (v_oid, 'Porție', true, 1, 1, 1) returning id into v_cust; -- reuse v_cust as group id holder
      insert into public.menu_options (group_id, name, price_delta_mdl, sort_order) values
        (v_cust, 'Standard', 0, 1), (v_cust, 'Mare', 30, 2);
    end if;
  end loop;
end $$;
