-- Notification outbox — reliable, UNIFORM Web Push for events that originate in
-- the database, not just in app code. This is what makes notifications
-- "complete":
--   * a NEW ORDER          -> pushes to every restaurant staff member
--   * EVERY dispatch OFFER -> pushes to the offered courier — initial dispatch
--     AND both cascade paths (decline cascade + the pg_cron expiry sweeper),
--     because the trigger fires on ANY insert into dispatch_offers regardless of
--     which RPC (app-driven or the background sweeper) created the row.
--
-- Flow: a SECURITY DEFINER trigger enqueues an outbox row -> a pg_cron job drains
-- it every 10s by POSTing the app's /api/push/drain endpoint via pg_net (the app
-- runs on the host, reachable from the DB container as host.docker.internal) ->
-- the route handler sends the actual push with the existing web-push sender.
-- The shared secret lives in a DB GUC (app.push_drain_secret) set out-of-band
-- (gitignored local seed) and mirrored in the app's PUSH_DRAIN_SECRET env, so no
-- secret is committed in this file.

create table if not exists public.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  body        text not null default '',
  url         text not null default '/',
  tag         text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0
);

-- Partial index over the drain's exact predicate (unsent, oldest first).
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (created_at)
  where sent_at is null;

-- Private table: only the service-role drainer (RLS-bypassing) and the SECURITY
-- DEFINER triggers write/read it. No anon/authenticated policies => locked.
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

-- ---------------------------------------------------------------------------
-- enqueue: a new order that needs restaurant attention -> restaurant staff
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_new_order_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r_name text;
  is_catering boolean := (new.order_type = 'catering');
begin
  select name into r_name from public.restaurants where id = new.restaurant_id;

  insert into public.notification_outbox (user_id, title, body, url, tag)
  select rs.user_id,
         case when is_catering then 'Cerere catering nouă 🍽️' else 'Comandă nouă 🔔' end,
         coalesce(r_name, 'Restaurant') || ' · ' || new.order_number,
         case when is_catering then '/restaurant/catering' else '/restaurant/orders' end,
         'neworder:' || new.id::text
  from public.restaurant_staff rs
  where rs.restaurant_id = new.restaurant_id;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_new_order_push on public.orders;
create trigger trg_enqueue_new_order_push
  after insert on public.orders
  for each row
  when (new.status = 'pending_restaurant')
  execute function public.enqueue_new_order_push();

-- ---------------------------------------------------------------------------
-- enqueue: every dispatch offer wave -> the offered courier
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_offer_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c_user   uuid;
  r_name   text;
  o_number text;
begin
  if new.status <> 'offered' then
    return new;
  end if;

  select user_id into c_user from public.couriers where id = new.courier_id;
  if c_user is null then
    return new;
  end if;

  select r.name, o.order_number
    into r_name, o_number
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where o.id = new.order_id;

  insert into public.notification_outbox (user_id, title, body, url, tag)
  values (c_user,
          'Comandă de livrat 🛵',
          coalesce(r_name, 'Restaurant') || ' · ' || coalesce(o_number, ''),
          '/deliveries',
          'offer:' || new.order_id::text);

  return new;
end;
$$;

drop trigger if exists trg_enqueue_offer_push on public.dispatch_offers;
create trigger trg_enqueue_offer_push
  after insert on public.dispatch_offers
  for each row execute function public.enqueue_offer_push();

-- ---------------------------------------------------------------------------
-- drain: pg_cron -> pg_net POST -> app /api/push/drain (only when work waits)
-- ---------------------------------------------------------------------------
select cron.schedule(
  'drain-push-outbox',
  '10 seconds',
  $$
    select net.http_post(
      url := coalesce(current_setting('app.push_drain_url', true), 'http://host.docker.internal:3000/api/push/drain'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-drain-secret', coalesce(current_setting('app.push_drain_secret', true), '')
      ),
      body := '{}'::jsonb
    )
    where exists (select 1 from public.notification_outbox where sent_at is null);
  $$
);
