-- Backend structure — DB-level >= 0 guards on order/item money columns.
-- The security-definer RPCs already recompute + validate every amount, but the
-- schema itself had no floor on these six columns (menu_items/menu_options/tip/
-- restaurant fees already do). This makes a negative order/item/quote amount
-- impossible at the storage layer too — defense in depth for the money layer.
-- (payouts gross/net are deliberately excluded: a clawback net is legitimately
-- negative. quoted_total_mdl is nullable; a CHECK passes on NULL.)

alter table public.orders
  add constraint orders_subtotal_mdl_nonneg check (subtotal_mdl >= 0),
  add constraint orders_delivery_fee_mdl_nonneg check (delivery_fee_mdl >= 0),
  add constraint orders_total_mdl_nonneg check (total_mdl >= 0);

alter table public.order_items
  add constraint order_items_unit_price_mdl_nonneg check (unit_price_mdl >= 0),
  add constraint order_items_line_total_mdl_nonneg check (line_total_mdl >= 0);

alter table public.catering_details
  add constraint catering_quoted_total_mdl_nonneg check (quoted_total_mdl >= 0);
