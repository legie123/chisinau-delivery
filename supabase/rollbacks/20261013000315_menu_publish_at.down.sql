select cron.unschedule('publish-scheduled-menu-items');
drop function if exists public.publish_scheduled_menu_items();
drop index if exists public.menu_items_publish_due_idx;
alter table public.menu_items drop column if exists publish_at;
