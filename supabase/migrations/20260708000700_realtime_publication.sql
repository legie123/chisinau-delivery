-- Supabase Realtime only streams postgres_changes for tables explicitly added
-- to the supabase_realtime publication — without this, every subscription in
-- the app connects successfully but never receives an event.
-- Tables the app subscribes to:
--   orders                 — customer tracking, restaurant queue refresh, catering tracking
--   catering_details       — customer catering tracking (quote status changes)
--   delivery_status_events — customer order timeline (INSERTs)

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.catering_details;
alter publication supabase_realtime add table public.delivery_status_events;
