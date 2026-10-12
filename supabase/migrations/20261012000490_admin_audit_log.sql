-- Admin audit trail: every intervention by a platform_admin (or a service_role server path) on an
-- operational table leaves one append-only row — who, which table/row, when, old and new values.
-- UPDATE rows keep only the changed keys. Customers, couriers and partners acting on their own
-- data and system jobs without a JWT (cron, migrations) are not logged. EVERY write made with the
-- service key is logged (fail-closed): a Server Action acting for an admin names that admin in the
-- `x-audit-actor` header (src/lib/supabase/admin.ts createAdminClient(actorId), mandatory) and is
-- attributed to them; without the header, or naming someone who is not a platform_admin, the row is
-- attributed to 'system' (payment webhook, push: createSystemClient()).
-- Scope, stated exactly: every table an admin or the service key can use to change money, orders,
-- people, permissions, config or impersonation (view_as_sessions) carries the trigger. NOT audited,
-- on purpose (high-volume telemetry, queues, per-user preferences, derived stats): courier_locations,
-- geofence_events, courier_shifts, courier_satisfaction_surveys, delivery_issue_reports,
-- dispatch_errors, notification_outbox, device_push_tokens, push_subscriptions, favorites,
-- restaurant_prep_stats. A service-key write there leaves no audit row.
-- Not covered (no trigger possible here): storage.objects and auth.users (invites go through the
-- GoTrue admin API; the couriers / restaurant_staff rows they create ARE logged, with the actor).
-- Personal data is masked, not copied: an erasure (erase_customer_pii) must not survive in its
-- own audit trail. Trigger argument: 'mask:<cols>' replaces those values with "***" (the change is
-- still recorded), 'only:<cols>' keeps just those keys.
-- Retention: 365 days, daily purge job (separate from purge_expired_pii, which another session owns).

create table if not exists public.admin_audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid,                         -- auth.uid(); null on a service_role path without sub
  actor_role  text not null check (actor_role in ('platform_admin', 'service_role', 'system')),
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name  text not null,
  row_id      text,
  old_values  jsonb,
  new_values  jsonb
);
alter table public.admin_audit_log drop constraint if exists admin_audit_log_actor_role_check;
alter table public.admin_audit_log add constraint admin_audit_log_actor_role_check
  check (actor_role in ('platform_admin', 'service_role', 'system'));
create index if not exists admin_audit_log_row_idx on public.admin_audit_log (table_name, row_id, at desc);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);
create index if not exists admin_audit_log_actor_idx on public.admin_audit_log (actor, at desc);

alter table public.admin_audit_log enable row level security;
drop policy if exists "admin_audit_log_admin_read" on public.admin_audit_log;
create policy "admin_audit_log_admin_read" on public.admin_audit_log
  for select to authenticated, viewer using ((select public.has_role('platform_admin')));
drop policy if exists viewer_session_live on public.admin_audit_log;
create policy viewer_session_live on public.admin_audit_log
  as restrictive for select to viewer using ((select public.viewer_session_live()));
revoke all on public.admin_audit_log from anon, authenticated, service_role;
grant select on public.admin_audit_log to authenticated, viewer;
revoke all on sequence public.admin_audit_log_id_seq from anon, authenticated, service_role;

-- Append-only for every API role (anon, authenticated, service_role: no write grant at all; the
-- trigger below also refuses UPDATE/DELETE that reach it). The table owner / a superuser can still
-- TRUNCATE or disable the trigger — that is a database-administrator action outside the app, not
-- something an admin user or the service key can do.
create or replace function public.admin_audit_log_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and current_setting('app.audit_purge', true) = 'on' and old.at < now() - interval '365 days' then
    return old;
  end if;
  raise exception 'Jurnalul de audit nu poate fi modificat sau șters.' using errcode = '42501';
end $$;
revoke all on function public.admin_audit_log_immutable() from public, anon, authenticated;
drop trigger if exists admin_audit_log_immutable on public.admin_audit_log;
create trigger admin_audit_log_immutable before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_immutable();

create or replace function public.audit_admin_mutation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role   text  := coalesce(v_claims->>'role', '');
  v_actor  uuid  := auth.uid();
  v_kind   text;
  v_mode   text  := coalesce(tg_argv[0], '');
  v_cols   text[];
  v_old    jsonb;
  v_new    jsonb;
  v_o      jsonb;
  v_n      jsonb;
  k        text;
begin
  if v_role = 'service_role' then
    -- Only a Server Action acting for a named admin is an intervention; webhooks/push are system.
    v_actor := null;
    k := nullif(current_setting('request.headers', true), '')::jsonb->>'x-audit-actor';
    if k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and exists (select 1 from public.profiles where id = k::uuid and role = 'platform_admin') then
      v_actor := k::uuid;
      v_kind := 'service_role';                      -- server path acting for a verified admin
    else
      v_kind := 'system';                            -- webhook / push / unnamed: still recorded
    end if;
  elsif v_actor is not null and public.has_role('platform_admin') then
    v_kind := 'platform_admin';
  else
    return null;                                     -- not an admin intervention
  end if;

  -- geo = generated PostGIS copy of lat/lng: never copied (it would bypass the lat/lng masks).
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old) - 'geo'; end if;
  if tg_op in ('UPDATE', 'INSERT') then v_new := to_jsonb(new) - 'geo'; end if;

  if tg_op = 'UPDATE' then                           -- keep only what changed
    select jsonb_object_agg(key, v_old->key), jsonb_object_agg(key, v_new->key)
      into v_o, v_n
      from jsonb_object_keys(v_new) as key
     where key not in ('updated_at', 'geo') and (v_old->key) is distinct from (v_new->key);
    if v_n is null then return null; end if;         -- nothing but timestamps changed
    v_old := v_o; v_new := v_n;
  end if;

  if v_mode like 'only:%' then
    v_cols := string_to_array(substr(v_mode, 6), ',');
    select jsonb_object_agg(key, v_old->key) into v_o from jsonb_object_keys(coalesce(v_old, '{}')) key where key = any(v_cols);
    select jsonb_object_agg(key, v_new->key) into v_n from jsonb_object_keys(coalesce(v_new, '{}')) key where key = any(v_cols);
    if v_o is null and v_n is null then return null; end if;
    v_old := v_o; v_new := v_n;
  elsif v_mode like 'mask:%' then
    v_cols := string_to_array(substr(v_mode, 6), ',');
    foreach k in array v_cols loop
      if v_old ? k and v_old->k <> 'null'::jsonb then v_old := jsonb_set(v_old, array[k], '"***"'); end if;
      if v_new ? k and v_new->k <> 'null'::jsonb then v_new := jsonb_set(v_new, array[k], '"***"'); end if;
    end loop;
  end if;

  -- An admin RPC may state why (set_config('app.audit_reason', …, true)); it rides along as _motiv.
  k := nullif(btrim(current_setting('app.audit_reason', true)), '');
  -- Free text like every other reason column: digit runs (phone, IDNP, card) are masked.
  if k is not null then
    v_new := coalesce(v_new, '{}'::jsonb) || jsonb_build_object('_motiv', regexp_replace(left(k, 500), '[0-9][0-9 .-]{4,}[0-9]', '***', 'g'));
  end if;

  insert into public.admin_audit_log (actor, actor_role, action, table_name, row_id, old_values, new_values)
  values (v_actor, v_kind, tg_op, tg_table_name,
          coalesce(to_jsonb(coalesce(new, old))->>'id', to_jsonb(coalesce(new, old))->>'order_id',
                   to_jsonb(coalesce(new, old))->>'recipient_id', to_jsonb(coalesce(new, old))->>'courier_id'),
          v_old, v_new);
  return null;
end $$;
revoke all on function public.audit_admin_mutation() from public, anon, authenticated;

-- Attach to every table an admin can change (RLS policies naming platform_admin, has_restaurant_access,
-- and the admin_* / set_* security definer RPCs).
do $$
declare
  t record;
begin
  for t in select * from (values
      ('orders',                  'mask:notes,cancellation_reason'),
      ('restaurants',             ''),
      ('restaurant_staff',        ''),
      ('restaurant_hours',        ''),
      ('menu_items',              ''),
      ('menu_categories',         ''),
      ('menu_option_groups',      ''),
      ('menu_options',            ''),
      ('couriers',                'mask:full_name,phone'),
      ('courier_suspensions',     'mask:reason,review_note'),
      ('courier_cash_movements',  'mask:note'),
      ('dispatch_offers',         ''),
      ('catering_details',        'mask:event_address_text,contact_person,contact_phone,restaurant_notes'),
      ('venue_bookings',          'mask:purpose,notes,contact_person,contact_phone,decline_reason'),
      ('addresses',               'mask:label,street_address,sector,building,apartment,entrance,floor,intercom_code,notes,lat,lng,contact_phone'),
      ('fraud_flags',             'mask:detail'),
      ('onboarding_applications', 'mask:full_name,phone,email,details,review_note'),
      ('kyc_documents',           ''),
      ('payouts',                 ''),
      ('payout_orders',           ''),
      ('payout_accounts',         'mask:iban,holder_name'),
      ('payout_adjustments',      'mask:reason'),
      ('order_complaints',        'mask:note,resolution'),
      ('ops_alerts',              ''),
      ('payment_intents',         ''),
      ('pricing_config',          ''),
      ('courier_tariff_config',   ''),
      ('cash_policy',             ''),
      ('dispatch_scoring_config', ''),
      ('platform_settings',       ''),
      ('profiles',                'only:role'),
      ('view_as_sessions',        'mask:reason'),
      ('order_items',             'mask:notes'),
      ('delivery_status_events',  'mask:note'),
      ('ratings',                 'mask:comment')
    ) as x(tbl, arg)
  loop
    if to_regclass('public.' || t.tbl) is null then continue; end if;
    execute format('drop trigger if exists zz_admin_audit on public.%I', t.tbl);
    execute format('create trigger zz_admin_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_admin_mutation(%L)', t.tbl, t.arg);
  end loop;
end $$;

create or replace function public.purge_admin_audit_log() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform set_config('app.audit_purge', 'on', true);
  delete from public.admin_audit_log where at < now() - interval '365 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
alter function public.purge_admin_audit_log() set statement_timeout = '30s';
revoke all on function public.purge_admin_audit_log() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('purge-admin-audit-log') where exists (select 1 from cron.job where jobname = 'purge-admin-audit-log');
  perform cron.schedule('purge-admin-audit-log', '40 3 * * *', 'select public.purge_admin_audit_log();');
end $$;
