-- Backend structure/perf — cover every foreign key with a leading-column index.
-- Audit (pg_constraint contype='f' vs pg_index indkey[0]) found 12 FKs with NO
-- covering index → seq scans on joins, FK lookups and ON DELETE cascades. Several
-- are hot paths: restaurant_staff.user_id is queried on EVERY restaurant-partner
-- page load; menu_items.category_id drives menu grouping; order_items.menu_item_id
-- backs reorder-replay + analytics. Indexes are additive + non-breaking.
--
-- Note: the existing unique(restaurant_id, user_id) on restaurant_staff leads with
-- restaurant_id, so a user_id lookup isn't covered — hence the explicit index below.

create index if not exists favorites_restaurant_id_idx on public.favorites (restaurant_id);
create index if not exists fraud_flags_reviewed_by_idx on public.fraud_flags (reviewed_by);
create index if not exists kyc_documents_application_id_idx on public.kyc_documents (application_id);
create index if not exists menu_categories_restaurant_id_idx on public.menu_categories (restaurant_id);
create index if not exists menu_items_category_id_idx on public.menu_items (category_id);
create index if not exists notification_outbox_user_id_idx on public.notification_outbox (user_id);
create index if not exists onboarding_applications_reviewed_by_idx on public.onboarding_applications (reviewed_by);
create index if not exists onboarding_applications_user_id_idx on public.onboarding_applications (user_id);
create index if not exists order_items_menu_item_id_idx on public.order_items (menu_item_id);
create index if not exists orders_delivery_address_id_idx on public.orders (delivery_address_id);
create index if not exists ratings_customer_id_idx on public.ratings (customer_id);
create index if not exists restaurant_staff_user_id_idx on public.restaurant_staff (user_id);

-- notification_outbox has RLS enabled with NO policies BY DESIGN: only the
-- delivery_status_events trigger (security definer) writes it and the push-drain
-- route claims it as the service role (bypasses RLS). Regular roles get deny-all.
comment on table public.notification_outbox is
  'RLS-enabled, deny-all by design: written only by the security-definer status trigger, drained only by the service role. Do not add authenticated/anon policies.';
