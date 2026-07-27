-- 20260727001600_rls_fast_path.sql
-- RLS fast-path: (select auth.uid()) initPlan caching + explicit TO role lists.
-- Generated from the live pg_policies catalog (schemaname in ('public','storage'))
-- on 2026-07-27. Every policy is dropped and recreated with the EXACT same
-- qual/with_check semantics; only two mechanical rewrites are applied:
--   1. bare auth.uid() -> (select auth.uid())  [initPlan once-per-statement]
--   2. explicit TO authenticated (or TO authenticated, anon for the public
--      restaurant/menu browse surface, which is read anonymously — verified
--      against src/app/(customer)/restaurants/**, and the SECURITY INVOKER
--      RPCs get_prep_estimates/search_menu_items/nearby_restaurants).
-- Helper functions (has_role/has_any_role/has_restaurant_access/current_courier_id/
-- customer_has_order_with_courier/etc.) are untouched — only auth.uid() references
-- written directly in policy text are rewritten.

begin;

drop policy if exists "addresses_courier_assigned_read" on "public"."addresses";
create policy "addresses_courier_assigned_read" on "public"."addresses" for select to authenticated using (courier_is_assigned_to_address(id));

drop policy if exists "addresses_owner_delete" on "public"."addresses";
create policy "addresses_owner_delete" on "public"."addresses" for delete to authenticated using ((customer_id = (select auth.uid())));

drop policy if exists "addresses_owner_read" on "public"."addresses";
create policy "addresses_owner_read" on "public"."addresses" for select to authenticated using (((customer_id = (select auth.uid())) OR has_role('platform_admin'::text)));

drop policy if exists "addresses_owner_update" on "public"."addresses";
create policy "addresses_owner_update" on "public"."addresses" for update to authenticated using ((customer_id = (select auth.uid()))) with check ((customer_id = (select auth.uid())));

drop policy if exists "addresses_owner_write" on "public"."addresses";
create policy "addresses_owner_write" on "public"."addresses" for insert to authenticated with check ((customer_id = (select auth.uid())));

drop policy if exists "catering_details_courier_read" on "public"."catering_details";
create policy "catering_details_courier_read" on "public"."catering_details" for select to authenticated using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = catering_details.order_id) AND (o.courier_id = current_courier_id())))));

drop policy if exists "catering_details_scoped_read" on "public"."catering_details";
create policy "catering_details_scoped_read" on "public"."catering_details" for select to authenticated using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = catering_details.order_id) AND ((o.customer_id = (select auth.uid())) OR has_restaurant_access(o.restaurant_id) OR has_role('platform_admin'::text))))));

drop policy if exists "courier_cash_movements_admin_read" on "public"."courier_cash_movements";
create policy "courier_cash_movements_admin_read" on "public"."courier_cash_movements" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "courier_cash_movements_self_read" on "public"."courier_cash_movements";
create policy "courier_cash_movements_self_read" on "public"."courier_cash_movements" for select to authenticated using ((courier_id = current_courier_id()));

drop policy if exists "courier_locations_admin_read" on "public"."courier_locations";
create policy "courier_locations_admin_read" on "public"."courier_locations" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "courier_locations_customer_read" on "public"."courier_locations";
create policy "courier_locations_customer_read" on "public"."courier_locations" for select to authenticated using (customer_has_active_order_with_courier(courier_id));

drop policy if exists "courier_locations_partner_read" on "public"."courier_locations";
create policy "courier_locations_partner_read" on "public"."courier_locations" for select to authenticated using (restaurant_has_active_order_with_courier(courier_id));

drop policy if exists "courier_locations_self_all" on "public"."courier_locations";
create policy "courier_locations_self_all" on "public"."courier_locations" for all to authenticated using ((courier_id = current_courier_id())) with check ((courier_id = current_courier_id()));

drop policy if exists "courier_satisfaction_admin_read" on "public"."courier_satisfaction_surveys";
create policy "courier_satisfaction_admin_read" on "public"."courier_satisfaction_surveys" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "courier_satisfaction_self_read" on "public"."courier_satisfaction_surveys";
create policy "courier_satisfaction_self_read" on "public"."courier_satisfaction_surveys" for select to authenticated using ((courier_id = current_courier_id()));

drop policy if exists "courier_shifts_admin_read" on "public"."courier_shifts";
create policy "courier_shifts_admin_read" on "public"."courier_shifts" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "courier_shifts_self_read" on "public"."courier_shifts";
create policy "courier_shifts_self_read" on "public"."courier_shifts" for select to authenticated using ((courier_id = current_courier_id()));

drop policy if exists "courier_suspensions_admin" on "public"."courier_suspensions";
create policy "courier_suspensions_admin" on "public"."courier_suspensions" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "courier_suspensions_self" on "public"."courier_suspensions";
create policy "courier_suspensions_self" on "public"."courier_suspensions" for select to authenticated using ((courier_id = current_courier_id()));

drop policy if exists "courier_tariff_config_read" on "public"."courier_tariff_config";
create policy "courier_tariff_config_read" on "public"."courier_tariff_config" for select to authenticated using (true);

drop policy if exists "couriers_admin_all" on "public"."couriers";
create policy "couriers_admin_all" on "public"."couriers" for all to authenticated using (has_role('platform_admin'::text)) with check (has_role('platform_admin'::text));

drop policy if exists "couriers_customer_scoped_read" on "public"."couriers";
create policy "couriers_customer_scoped_read" on "public"."couriers" for select to authenticated using (customer_has_order_with_courier(id));

drop policy if exists "couriers_self_read" on "public"."couriers";
create policy "couriers_self_read" on "public"."couriers" for select to authenticated using ((user_id = (select auth.uid())));

drop policy if exists "delivery_status_events_scoped_read" on "public"."delivery_status_events";
create policy "delivery_status_events_scoped_read" on "public"."delivery_status_events" for select to authenticated using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = delivery_status_events.order_id) AND ((o.customer_id = (select auth.uid())) OR has_restaurant_access(o.restaurant_id) OR (o.courier_id = current_courier_id()) OR has_role('platform_admin'::text))))));

drop policy if exists "dispatch_offers_admin_read" on "public"."dispatch_offers";
create policy "dispatch_offers_admin_read" on "public"."dispatch_offers" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "dispatch_offers_courier_read" on "public"."dispatch_offers";
create policy "dispatch_offers_courier_read" on "public"."dispatch_offers" for select to authenticated using ((courier_id = current_courier_id()));

drop policy if exists "dispatch_scoring_config_admin" on "public"."dispatch_scoring_config";
create policy "dispatch_scoring_config_admin" on "public"."dispatch_scoring_config" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "favorites_self" on "public"."favorites";
create policy "favorites_self" on "public"."favorites" for all to authenticated using ((customer_id = (select auth.uid()))) with check ((customer_id = (select auth.uid())));

drop policy if exists "fraud_flags_admin_read" on "public"."fraud_flags";
create policy "fraud_flags_admin_read" on "public"."fraud_flags" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "fraud_flags_admin_review" on "public"."fraud_flags";
create policy "fraud_flags_admin_review" on "public"."fraud_flags" for update to authenticated using (has_role('platform_admin'::text)) with check (has_role('platform_admin'::text));

drop policy if exists "geofence_events_admin_read" on "public"."geofence_events";
create policy "geofence_events_admin_read" on "public"."geofence_events" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "geofence_events_self_read" on "public"."geofence_events";
create policy "geofence_events_self_read" on "public"."geofence_events" for select to authenticated using ((courier_id = current_courier_id()));

drop policy if exists "kyc_admin_read" on "public"."kyc_documents";
create policy "kyc_admin_read" on "public"."kyc_documents" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "kyc_self_read" on "public"."kyc_documents";
create policy "kyc_self_read" on "public"."kyc_documents" for select to authenticated using ((EXISTS ( SELECT 1
   FROM onboarding_applications a
  WHERE ((a.id = kyc_documents.application_id) AND (a.user_id = (select auth.uid()))))));

drop policy if exists "menu_categories_public_read" on "public"."menu_categories";
create policy "menu_categories_public_read" on "public"."menu_categories" for select to authenticated, anon using (true);

drop policy if exists "menu_categories_staff_write" on "public"."menu_categories";
create policy "menu_categories_staff_write" on "public"."menu_categories" for all to authenticated using (has_restaurant_access(restaurant_id)) with check (has_restaurant_access(restaurant_id));

drop policy if exists "menu_items_public_read" on "public"."menu_items";
create policy "menu_items_public_read" on "public"."menu_items" for select to authenticated, anon using ((((is_available = true) AND (EXISTS ( SELECT 1
   FROM restaurants r
  WHERE ((r.id = menu_items.restaurant_id) AND r.is_active)))) OR has_restaurant_access(restaurant_id)));

drop policy if exists "menu_items_staff_write" on "public"."menu_items";
create policy "menu_items_staff_write" on "public"."menu_items" for all to authenticated using (has_restaurant_access(restaurant_id)) with check (has_restaurant_access(restaurant_id));

drop policy if exists "menu_option_groups_public_read" on "public"."menu_option_groups";
create policy "menu_option_groups_public_read" on "public"."menu_option_groups" for select to authenticated, anon using ((EXISTS ( SELECT 1
   FROM (menu_items mi
     JOIN restaurants r ON ((r.id = mi.restaurant_id)))
  WHERE ((mi.id = menu_option_groups.menu_item_id) AND ((mi.is_available AND r.is_active) OR has_restaurant_access(r.id))))));

drop policy if exists "menu_option_groups_staff_write" on "public"."menu_option_groups";
create policy "menu_option_groups_staff_write" on "public"."menu_option_groups" for all to authenticated using ((EXISTS ( SELECT 1
   FROM menu_items mi
  WHERE ((mi.id = menu_option_groups.menu_item_id) AND has_restaurant_access(mi.restaurant_id))))) with check ((EXISTS ( SELECT 1
   FROM menu_items mi
  WHERE ((mi.id = menu_option_groups.menu_item_id) AND has_restaurant_access(mi.restaurant_id)))));

drop policy if exists "menu_options_public_read" on "public"."menu_options";
create policy "menu_options_public_read" on "public"."menu_options" for select to authenticated, anon using ((EXISTS ( SELECT 1
   FROM ((menu_option_groups g
     JOIN menu_items mi ON ((mi.id = g.menu_item_id)))
     JOIN restaurants r ON ((r.id = mi.restaurant_id)))
  WHERE ((g.id = menu_options.group_id) AND ((mi.is_available AND r.is_active) OR has_restaurant_access(r.id))))));

drop policy if exists "menu_options_staff_write" on "public"."menu_options";
create policy "menu_options_staff_write" on "public"."menu_options" for all to authenticated using ((EXISTS ( SELECT 1
   FROM (menu_option_groups g
     JOIN menu_items mi ON ((mi.id = g.menu_item_id)))
  WHERE ((g.id = menu_options.group_id) AND has_restaurant_access(mi.restaurant_id))))) with check ((EXISTS ( SELECT 1
   FROM (menu_option_groups g
     JOIN menu_items mi ON ((mi.id = g.menu_item_id)))
  WHERE ((g.id = menu_options.group_id) AND has_restaurant_access(mi.restaurant_id)))));

drop policy if exists "onboarding_admin_all" on "public"."onboarding_applications";
create policy "onboarding_admin_all" on "public"."onboarding_applications" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "onboarding_self_read" on "public"."onboarding_applications";
create policy "onboarding_self_read" on "public"."onboarding_applications" for select to authenticated using ((user_id = (select auth.uid())));

drop policy if exists "order_items_scoped_read" on "public"."order_items";
create policy "order_items_scoped_read" on "public"."order_items" for select to authenticated using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND ((o.customer_id = (select auth.uid())) OR has_restaurant_access(o.restaurant_id) OR (o.courier_id = current_courier_id()) OR has_role('platform_admin'::text))))));

drop policy if exists "orders_admin_all" on "public"."orders";
create policy "orders_admin_all" on "public"."orders" for all to authenticated using (has_role('platform_admin'::text)) with check (has_role('platform_admin'::text));

drop policy if exists "orders_courier_read_unassigned" on "public"."orders";
create policy "orders_courier_read_unassigned" on "public"."orders" for select to authenticated using (((status = 'ready_for_pickup'::text) AND (courier_id IS NULL) AND has_role('courier'::text)));

drop policy if exists "orders_courier_scope" on "public"."orders";
create policy "orders_courier_scope" on "public"."orders" for select to authenticated using ((courier_id = current_courier_id()));

drop policy if exists "orders_customer_read_own" on "public"."orders";
create policy "orders_customer_read_own" on "public"."orders" for select to authenticated using ((customer_id = (select auth.uid())));

drop policy if exists "orders_partner_scope" on "public"."orders";
create policy "orders_partner_scope" on "public"."orders" for select to authenticated using (has_restaurant_access(restaurant_id));

drop policy if exists "payment_intents_admin_read" on "public"."payment_intents";
create policy "payment_intents_admin_read" on "public"."payment_intents" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "payment_intents_customer_read" on "public"."payment_intents";
create policy "payment_intents_customer_read" on "public"."payment_intents" for select to authenticated using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = payment_intents.order_id) AND (o.customer_id = (select auth.uid()))))));

drop policy if exists "payout_orders_admin_read" on "public"."payout_orders";
create policy "payout_orders_admin_read" on "public"."payout_orders" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "payouts_admin_read" on "public"."payouts";
create policy "payouts_admin_read" on "public"."payouts" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "payouts_courier_read" on "public"."payouts";
create policy "payouts_courier_read" on "public"."payouts" for select to authenticated using (((recipient_type = 'courier'::text) AND (recipient_id IN ( SELECT couriers.id
   FROM couriers
  WHERE (couriers.user_id = (select auth.uid()))))));

drop policy if exists "payouts_restaurant_read" on "public"."payouts";
create policy "payouts_restaurant_read" on "public"."payouts" for select to authenticated using (((recipient_type = 'restaurant'::text) AND has_restaurant_access(recipient_id)));

drop policy if exists "platform_settings_admin" on "public"."platform_settings";
create policy "platform_settings_admin" on "public"."platform_settings" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "pricing_config_read" on "public"."pricing_config";
create policy "pricing_config_read" on "public"."pricing_config" for select to authenticated using (true);

drop policy if exists "profiles_read_own" on "public"."profiles";
create policy "profiles_read_own" on "public"."profiles" for select to authenticated using (((id = (select auth.uid())) OR has_role('platform_admin'::text)));

drop policy if exists "profiles_update_own" on "public"."profiles";
create policy "profiles_update_own" on "public"."profiles" for update to authenticated using ((id = (select auth.uid()))) with check ((id = (select auth.uid())));

drop policy if exists "push_subs_self" on "public"."push_subscriptions";
create policy "push_subs_self" on "public"."push_subscriptions" for all to authenticated using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));

drop policy if exists "ratings_admin_all_read" on "public"."ratings";
create policy "ratings_admin_all_read" on "public"."ratings" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "ratings_courier_read_own" on "public"."ratings";
create policy "ratings_courier_read_own" on "public"."ratings" for select to authenticated using (((target_type = 'courier'::text) AND (courier_id IN ( SELECT couriers.id
   FROM couriers
  WHERE (couriers.user_id = (select auth.uid()))))));

drop policy if exists "ratings_customer_read_own" on "public"."ratings";
create policy "ratings_customer_read_own" on "public"."ratings" for select to authenticated using ((customer_id = (select auth.uid())));

drop policy if exists "ratings_partner_read" on "public"."ratings";
create policy "ratings_partner_read" on "public"."ratings" for select to authenticated using (((target_type = 'restaurant'::text) AND has_restaurant_access(restaurant_id)));

drop policy if exists "restaurant_hours_public_read" on "public"."restaurant_hours";
create policy "restaurant_hours_public_read" on "public"."restaurant_hours" for select to authenticated, anon using (true);

drop policy if exists "restaurant_hours_staff_write" on "public"."restaurant_hours";
create policy "restaurant_hours_staff_write" on "public"."restaurant_hours" for all to authenticated using (has_restaurant_access(restaurant_id)) with check (has_restaurant_access(restaurant_id));

drop policy if exists "prep_stats_public_read" on "public"."restaurant_prep_stats";
create policy "prep_stats_public_read" on "public"."restaurant_prep_stats" for select to authenticated, anon using (true);

drop policy if exists "restaurant_staff_admin_write" on "public"."restaurant_staff";
create policy "restaurant_staff_admin_write" on "public"."restaurant_staff" for all to authenticated using (has_role('platform_admin'::text)) with check (has_role('platform_admin'::text));

drop policy if exists "restaurant_staff_read" on "public"."restaurant_staff";
create policy "restaurant_staff_read" on "public"."restaurant_staff" for select to authenticated using (has_restaurant_access(restaurant_id));

drop policy if exists "restaurants_admin_insert" on "public"."restaurants";
create policy "restaurants_admin_insert" on "public"."restaurants" for insert to authenticated with check (has_role('platform_admin'::text));

drop policy if exists "restaurants_admin_read" on "public"."restaurants";
create policy "restaurants_admin_read" on "public"."restaurants" for select to authenticated using (has_role('platform_admin'::text));

drop policy if exists "restaurants_public_read" on "public"."restaurants";
create policy "restaurants_public_read" on "public"."restaurants" for select to authenticated, anon using (((is_active = true) OR has_restaurant_access(id)));

drop policy if exists "restaurants_staff_write" on "public"."restaurants";
create policy "restaurants_staff_write" on "public"."restaurants" for update to authenticated using (has_restaurant_access(id)) with check (has_restaurant_access(id));

drop policy if exists "kyc_read_own_or_admin" on "storage"."objects";
create policy "kyc_read_own_or_admin" on "storage"."objects" for select to authenticated using (((bucket_id = 'kyc-documents'::text) AND (((storage.foldername(name))[1] = ((select auth.uid()))::text) OR has_role('platform_admin'::text))));

drop policy if exists "kyc_upload_own" on "storage"."objects";
create policy "kyc_upload_own" on "storage"."objects" for insert to authenticated with check (((bucket_id = 'kyc-documents'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

drop policy if exists "restaurant_photos_public_read" on "storage"."objects";
create policy "restaurant_photos_public_read" on "storage"."objects" for select to authenticated, anon using ((bucket_id = 'restaurant-photos'::text));

drop policy if exists "restaurant_photos_staff_delete" on "storage"."objects";
create policy "restaurant_photos_staff_delete" on "storage"."objects" for delete to authenticated using (((bucket_id = 'restaurant-photos'::text) AND has_restaurant_access(((storage.foldername(name))[1])::uuid)));

drop policy if exists "restaurant_photos_staff_update" on "storage"."objects";
create policy "restaurant_photos_staff_update" on "storage"."objects" for update to authenticated using (((bucket_id = 'restaurant-photos'::text) AND has_restaurant_access(((storage.foldername(name))[1])::uuid)));

drop policy if exists "restaurant_photos_staff_write" on "storage"."objects";
create policy "restaurant_photos_staff_write" on "storage"."objects" for insert to authenticated with check (((bucket_id = 'restaurant-photos'::text) AND has_restaurant_access(((storage.foldername(name))[1])::uuid)));

commit;