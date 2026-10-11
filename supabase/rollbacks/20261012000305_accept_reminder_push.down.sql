-- Rollback of 20261012000305_accept_reminder_push. Already-queued reminder rows stay in
-- notification_outbox (they are sent or pruned like any other push).
select cron.unschedule('remind-pending-orders');
drop function if exists public.remind_pending_restaurant_orders();
