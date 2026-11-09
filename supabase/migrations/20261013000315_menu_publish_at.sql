-- Menu editor parity (4/4): draft → publish on a schedule. A hidden item gets `publish_at`
-- (scheduleItemPublish: own restaurant, hidden, has photo, < 30 days ahead); pg_cron runs
-- publish_scheduled_menu_items() every minute and flips is_available=true, clearing publish_at.
-- The photo gate is re-checked here (same rule as toggleItemAvailability): a photo removed
-- between scheduling and the run leaves the item hidden with publish_at kept, so the partner
-- sees it still "programat" and can fix the photo. Returns the number of items published.
-- Sim 218. Rollback: supabase/rollbacks/20261013000315_*.down.sql.
alter table public.menu_items add column publish_at timestamptz;

create index menu_items_publish_due_idx on public.menu_items (publish_at) where publish_at is not null;

create or replace function public.publish_scheduled_menu_items()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.menu_items
     set is_available = true, publish_at = null
   where publish_at <= now()
     and is_available = false
     and photo_url is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

alter function public.publish_scheduled_menu_items() set statement_timeout = '5s';
revoke all on function public.publish_scheduled_menu_items() from public, anon, authenticated;
grant execute on function public.publish_scheduled_menu_items() to service_role;

select cron.schedule('publish-scheduled-menu-items', '* * * * *', 'select public.publish_scheduled_menu_items();');
