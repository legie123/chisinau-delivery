-- Performance indexes from the W9 analysis pass.

-- Every tracking/detail page filters order_items by order_id (Postgres does
-- not auto-index FK columns) — the fastest-growing table in the schema was
-- seq-scanned on the hottest pages.
create index order_items_order_idx on public.order_items(order_id);

-- Courier available-orders feed: orders_courier_idx is partial WHERE
-- courier_id IS NOT NULL, which excludes exactly these rows; this partial
-- index stays tiny and serves both the feed query and the
-- orders_courier_read_unassigned RLS predicate.
create index orders_available_feed_idx on public.orders(created_at)
  where status = 'ready_for_pickup' and courier_id is null;
