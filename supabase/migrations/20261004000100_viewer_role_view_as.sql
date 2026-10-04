-- "Vezi ca" (view-as): the platform admin opens a user's surface in the master shell and sees
-- exactly what that user sees — READ-ONLY, 15 minutes, audited. Read-only is enforced HERE, by
-- the database, not by the app: the view runs on a JWT with role `viewer` (sub = the target),
-- and `viewer` is a Postgres role that can read what `authenticated` can read and do nothing else.
--
-- Mechanism, each piece proven on a throwaway clone (sim 73 is the standing proof):
--   * `viewer` is NOT a member of `authenticated`. With INHERIT it would inherit every write
--     grant; with INHERIT FALSE the RLS policies `TO authenticated` stop applying to it (policy
--     role matching uses has_privs_of_role) — viewer then sees zero rows. So viewer gets its
--     own SELECT grants and is ADDED to every SELECT/ALL policy that applies to authenticated
--     (same USING expression, so the same rows the target sees). Generated from the live catalog.
--   * Functions: Postgres gives EXECUTE to PUBLIC by default, and 41 public functions still had
--     it (submit_rating, set_order_tip, start_online_payment, … — SECURITY DEFINER writers a
--     viewer could otherwise call as the target). PUBLIC is revoked on every public function;
--     anon/authenticated/service_role keep exactly the EXECUTE they had (asserted). viewer gets
--     EXECUTE only on an allowlist: the helpers RLS/views evaluate for it (pg_depend) plus the
--     read RPCs the viewed pages call — every one of them must be non-VOLATILE (asserted).
--   * A live session row is required: a RESTRICTIVE policy `TO viewer` on every table it can
--     read checks `viewer_session_live()` — the token's `view_as_session` must be this target's
--     session, not ended, not expired. end_view_as() therefore revokes at once, not at JWT exp.
--   * GoTrue is not the DB: a token with role=viewer and no session_id is accepted by GoTrue for
--     PUT /auth/v1/user (measured: it reached email validation). The minting route therefore puts
--     `session_id` = the view-as session id, which is never an auth.sessions row → GoTrue answers
--     403 session_not_found to every call with it. The app answers getUser() for it locally.
-- Not covered (documented):
--   * Realtime private channels (courier GPS): realtime.messages lives in schema realtime, whose
--     USAGE only supabase_admin can grant — tried from this migration role: "no privileges were
--     granted". A view therefore receives no private broadcast; postgres_changes on public tables
--     only needs what is granted here (SELECT + the policies), but was not exercised end-to-end.
--   * Storage (supabase_storage_admin is not a member of viewer → private buckets/signed URLs fail).

-- 1. The role --------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'viewer') then
    create role viewer nologin noinherit;
  end if;
end $$;

-- PostgREST connects as authenticator and SET ROLEs to the JWT's role.
grant viewer to authenticator;
-- The SQL sims run as postgres and need SET ROLE viewer — membership without inheritance.
grant viewer to postgres with inherit false, set true;

-- public only. auth.uid() inside a policy needs EXECUTE (PUBLIC has it), not USAGE on schema
-- auth: a stored policy expression is not name-resolved again. Schemas auth/realtime/storage
-- are owned by supabase_admin and their USAGE can't be granted by the migration role anyway.
grant usage on schema public to viewer;

-- 2. Audit table -----------------------------------------------------------------------------
-- The row IS the audit trail. Clients get SELECT on their own rows and nothing else: inserting or
-- updating directly would let an admin forge or erase it, so writes go through the RPCs only.
create table public.view_as_sessions (
  id uuid primary key default gen_random_uuid(),
  -- restrict: an admin with an audit trail is deactivated, not hard-deleted.
  admin_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  target_app text not null check (target_app in ('client', 'curier', 'restaurant')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  check (expires_at > started_at),
  check (ended_at is null or ended_at >= started_at)
);
create index view_as_sessions_admin_idx on public.view_as_sessions (admin_id, started_at desc);
create index view_as_sessions_target_idx on public.view_as_sessions (target_user_id, started_at desc);

alter table public.view_as_sessions enable row level security;
grant select on public.view_as_sessions to authenticated;
grant all on public.view_as_sessions to service_role;

create policy view_as_sessions_admin_read on public.view_as_sessions
  for select to authenticated
  using (admin_id = (select auth.uid()) and (select public.has_role('platform_admin')));

-- 3. RPCs ------------------------------------------------------------------------------------
create or replace function public.start_view_as(p_target uuid, p_app text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin uuid := auth.uid();
  v_role text;
  v_id uuid;
begin
  -- Caller authorization (hard rule 3): platform_admin only. A viewer token cannot even reach
  -- this line — viewer has no EXECUTE on it.
  if v_admin is null or not public.has_role('platform_admin') then
    raise exception 'Doar administratorul platformei poate porni vizualizarea.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Scrie motivul vizualizării (minim 3 caractere).' using errcode = '22023';
  end if;

  select role into v_role from public.profiles where id = p_target;
  if v_role is null then
    raise exception 'Utilizatorul nu există.' using errcode = 'P0002';
  end if;
  -- The target must actually have the surface: a courier is profiles.role AND a couriers row
  -- (hard rule 5), a partner is staffed at a restaurant. Admins are never a target.
  if not (
       (p_app = 'client' and v_role = 'customer')
    or (p_app = 'curier' and v_role = 'courier'
        and exists (select 1 from public.couriers c where c.user_id = p_target))
    or (p_app = 'restaurant' and v_role = 'restaurant_partner'
        and exists (select 1 from public.restaurant_staff s where s.user_id = p_target))
  ) then
    raise exception 'Utilizatorul nu are suprafața „%”.', coalesce(p_app, '') using errcode = '22023';
  end if;

  insert into public.view_as_sessions (admin_id, target_user_id, target_app, expires_at, reason)
  values (v_admin, p_target, p_app, now() + interval '15 minutes', btrim(p_reason))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.end_view_as(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Only the admin who started it; ending twice is a no-op.
  update public.view_as_sessions
     set ended_at = now()
   where id = p_session and admin_id = auth.uid() and ended_at is null;
end;
$$;

-- True only inside a live view-as session for THIS target. Evaluated once per statement
-- (wrapped in SELECT by the policies below). A malformed claim is "not live", never an error.
create or replace function public.viewer_session_live()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.view_as_sessions s
    where s.id = case
            when (auth.jwt() ->> 'view_as_session')
                 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then (auth.jwt() ->> 'view_as_session')::uuid
          end
      and s.target_user_id = auth.uid()
      and s.ended_at is null
      and s.expires_at > now()
  );
$$;

revoke all on function public.start_view_as(uuid, text, text) from public;
revoke all on function public.end_view_as(uuid) from public;
revoke all on function public.viewer_session_live() from public;
grant execute on function public.start_view_as(uuid, text, text) to authenticated;
grant execute on function public.end_view_as(uuid) to authenticated;
grant execute on function public.viewer_session_live() to authenticated, service_role;

-- It only reads (current_courier_id / current_cash_policy / courier_cash_balance /
-- effective_cash_cap, all STABLE); VOLATILE was an oversight that keeps the courier's cash panel
-- out of the viewer allowlist, whose rule is "no VOLATILE function".
alter function public.get_courier_cash_status() stable;

-- 4. purge_expired_pii(): recreated from its LIVE body (20260806000300) + ONE delta (step 5):
--    view-as audit rows carry an admin-written reason → kept 365 days (provisional).
create or replace function public.purge_expired_pii()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
begin
  -- 0. Geofence hint events (precise GPS, same retention class as courier
  --    GPS below) — 2 years.
  delete from public.geofence_events where created_at < now() - interval '2 years';

  -- 0b. Delivery-proof (POD) photos — 90 days. Storage object first, then null
  --     out any orders.pod_photo_path that no longer has a backing object (so
  --     the admin/customer signed-URL path never dangles against a deleted file).
  --     storage.objects carries a protect_delete() trigger that raises on any
  --     direct SQL DELETE unless storage.allow_delete_query is set — this is
  --     the Storage API's own safety net against accidental object-table
  --     deletes, and applies to this SECURITY DEFINER function exactly like
  --     any other session. set_config(..., true) scopes it to this
  --     transaction only (this function's single-statement cron invocation).
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'delivery-proof' and created_at < now() - interval '90 days';
  update public.orders o set pod_photo_path = null
  where o.pod_photo_path is not null
    and not exists (
      select 1 from storage.objects s where s.bucket_id = 'delivery-proof' and s.name = o.pod_photo_path
    );

  -- 1. Courier GPS last-known position — 2 years (Bolt's published window).
  delete from public.courier_locations where updated_at < now() - interval '2 years';

  -- 2. Address access details (intercom code + free-text notes) — redact for
  --    customers with no order in the last year.
  update public.addresses a
    set intercom_code = null, notes = null
  where (a.intercom_code is not null or a.notes is not null)
    and not exists (
      select 1 from public.orders o
      where o.customer_id = a.customer_id and o.created_at > now() - interval '365 days'
    );

  -- 3. Dormant customer accounts — had orders, but none in 3 years → anonymize the
  --    personal data. Order/rating/payout rows are PRESERVED (10-year fiscal
  --    retention); only name/phone/address are scrubbed.
  update public.profiles p
    set full_name = 'Utilizator șters', phone = null
  where p.role = 'customer'
    and exists (select 1 from public.orders o where o.customer_id = p.id)
    and not exists (
      select 1 from public.orders o
      where o.customer_id = p.id and o.created_at > now() - interval '3 years'
    );

  update public.addresses a
    set street_address = 'Adresă ștearsă', label = null, sector = null, building = null,
        apartment = null, entrance = null, floor = null, intercom_code = null, notes = null,
        lat = null, lng = null
  where a.customer_id in (
    select p.id from public.profiles p
    where p.role = 'customer'
      and exists (select 1 from public.orders o where o.customer_id = p.id)
      and not exists (
        select 1 from public.orders o
        where o.customer_id = p.id and o.created_at > now() - interval '3 years'
      )
  );

  -- Old customer order notes may carry personal instructions — scrub past 3 years.
  update public.orders set notes = null
  where notes is not null and created_at < now() - interval '3 years';

  -- 4. KYC identity documents (buletin/pasaport) — the most sensitive PII in the
  --    schema. Retained ONLY while the person is on the platform (approved
  --    application). For rejected (90d after review) and abandoned pending (180d
  --    after creation) applications the docs are purged: storage object first
  --    (same allow_delete_query guard set above), then the kyc_documents row,
  --    then the application's own PII is scrubbed (status + timestamps kept for
  --    audit). Approved applications are deliberately untouched here.
  delete from storage.objects
  where bucket_id = 'kyc-documents'
    and name in (
      select k.storage_path from public.kyc_documents k
      join public.onboarding_applications a on a.id = k.application_id
      where (a.status = 'rejected' and coalesce(a.reviewed_at, a.created_at) < now() - interval '90 days')
         or (a.status = 'pending'  and a.created_at < now() - interval '180 days')
    );

  delete from public.kyc_documents k
  using public.onboarding_applications a
  where a.id = k.application_id
    and ((a.status = 'rejected' and coalesce(a.reviewed_at, a.created_at) < now() - interval '90 days')
      or (a.status = 'pending'  and a.created_at < now() - interval '180 days'));

  update public.onboarding_applications a
    set full_name = 'Solicitant șters', phone = '', email = null, details = '{}'::jsonb
  where (a.status = 'rejected' and coalesce(a.reviewed_at, a.created_at) < now() - interval '90 days')
     or (a.status = 'pending'  and a.created_at < now() - interval '180 days');

  -- 5. View-as audit (admin-written reason + who looked at whom) — 365 days.
  delete from public.view_as_sessions where started_at < now() - interval '365 days';
end;
$function$;

-- 5. Generated from the live catalog -----------------------------------------------------------
do $$
declare
  r record;
  v_roles text;
  n_grants int := 0;
  n_policies int := 0;
  n_live int := 0;
  n_revoked int := 0;
  n_allow int := 0;
  n_bad int;
begin
  -- Snapshot of who can EXECUTE what among the API roles, to prove the PUBLIC revoke is neutral.
  create temp table _exec_before on commit drop as
    select p.oid, api.rolname, has_function_privilege(api.rolname, p.oid, 'EXECUTE') as can
    from pg_proc p
    cross join (values ('anon'), ('authenticated'), ('service_role')) as api(rolname)
    where p.pronamespace = 'public'::regnamespace;

  -- Hard rule 7: the shared remote project also holds the dormant Trade-AI objects. Every sweep
  -- below skips them, so the remote sync never touches their grants, policies or function ACLs
  -- (verifier, 2026-10-04). Same name predicate as 20261003000100; functions by the same prefixes.
  create temp table _trade_ai on commit drop as
    select 'pg_class'::regclass as cat, c.oid from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and (c.relname like 'poly%' or c.relname like 'gladiator%' or c.relname in ('equity_history', 'syndicate_audits'))
    union all
    select 'pg_proc'::regclass, p.oid from pg_proc p
    where p.pronamespace = 'public'::regnamespace and (p.proname like 'poly%' or p.proname like 'gladiator%');

  -- 5a. SELECT on every relation in public that authenticated can SELECT (effective privilege).
  for r in
    select c.oid::regclass as rel
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('authenticated', c.oid, 'SELECT')
      and c.oid not in (select t.oid from _trade_ai t where t.cat = 'pg_class'::regclass)
  loop
    execute format('grant select on %s to viewer', r.rel);
    n_grants := n_grants + 1;
  end loop;

  -- 5b. viewer joins every SELECT/ALL policy (permissive AND restrictive) in public that applies
  --     to authenticated. Roles are re-listed as they are; the USING expression is untouched.
  for r in
    select pol.polname, pol.polrelid::regclass as rel, pol.polroles
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    where c.relnamespace = 'public'::regnamespace
      and pol.polcmd in ('r', '*')
      and 'authenticated'::regrole = any (pol.polroles)
      and not 'viewer'::regrole = any (pol.polroles)
      and c.oid not in (select t.oid from _trade_ai t where t.cat = 'pg_class'::regclass)
  loop
    select string_agg(case when x.oid = 0 then 'public' else quote_ident(pg_get_userbyid(x.oid)) end, ', ')
      into v_roles
      from unnest(r.polroles) as x(oid);
    execute format('alter policy %I on %s to %s, viewer', r.polname, r.rel, v_roles);
    n_policies := n_policies + 1;
  end loop;

  -- 5c. A live session is required on everything viewer can read (restrictive, viewer only).
  for r in
    select c.oid::regclass as rel
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
      and has_table_privilege('viewer', c.oid, 'SELECT')
      and c.oid not in (select t.oid from _trade_ai t where t.cat = 'pg_class'::regclass)
      and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid and pol.polname = 'viewer_session_live')
  loop
    execute format(
      'create policy viewer_session_live on %s as restrictive for select to viewer using ((select public.viewer_session_live()))',
      r.rel);
    n_live := n_live + 1;
  end loop;

  -- 5d. No more EXECUTE for PUBLIC on public functions; the API roles keep exactly what they had.
  for r in
    select p.oid, p.oid::regprocedure as fn,
           has_function_privilege('anon', p.oid, 'EXECUTE') as a,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as u,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as s
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                  where x.grantee = 0 and x.privilege_type = 'EXECUTE')
      and p.oid not in (select t.oid from _trade_ai t where t.cat = 'pg_proc'::regclass)
  loop
    if r.a then execute format('grant execute on routine %s to anon', r.fn); end if;
    if r.u then execute format('grant execute on routine %s to authenticated', r.fn); end if;
    if r.s then execute format('grant execute on routine %s to service_role', r.fn); end if;
    execute format('revoke execute on routine %s from public', r.fn);
    n_revoked := n_revoked + 1;
  end loop;

  -- 5e. viewer EXECUTE allowlist: what its RLS policies and its views evaluate (pg_depend), plus
  --     the read RPCs the viewed pages call (src/app/(customer|courier)/**, (admin)/restaurant/**).
  for r in
    select distinct p.oid, p.oid::regprocedure as fn, p.provolatile
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (
        p.oid in (select d.refobjid from pg_depend d
                  join pg_policy pol on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
                  where d.refclassid = 'pg_proc'::regclass
                    and pol.polcmd in ('r', '*') and 'viewer'::regrole = any (pol.polroles))
        or p.oid in (select d.refobjid from pg_depend d
                     join pg_rewrite rw on d.classid = 'pg_rewrite'::regclass and d.objid = rw.oid
                     where d.refclassid = 'pg_proc'::regclass
                       and has_table_privilege('viewer', rw.ev_class, 'SELECT'))
        or p.oid = any (array[
             'public.get_prep_estimates(uuid[])',
             'public.popular_hours(uuid)',
             'public.rating_breakdown(uuid)',
             'public.current_pricing_config()',
             'public.get_courier_cash_status()'
           ]::regprocedure[])
      )
  loop
    if r.provolatile = 'v' then
      raise exception 'viewer allowlist: % is VOLATILE — a reader must be STABLE/IMMUTABLE', r.fn;
    end if;
    execute format('grant execute on routine %s to viewer', r.fn);
    n_allow := n_allow + 1;
  end loop;

  -- Guards ---------------------------------------------------------------------------------
  -- G1 SELECT parity with authenticated (public).
  select count(*) into n_bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and c.oid not in (select t.oid from _trade_ai t where t.cat = 'pg_class'::regclass)
    and has_table_privilege('authenticated', c.oid, 'SELECT') <> has_table_privilege('viewer', c.oid, 'SELECT');
  if n_bad > 0 then raise exception 'viewer guard G1: % relations differ in SELECT from authenticated', n_bad; end if;

  -- G2 zero write privilege on any relation in any schema viewer can reach.
  select count(*) into n_bad from pg_class c
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace, 'realtime'::regnamespace)
    and (has_table_privilege('viewer', c.oid, 'INSERT') or has_table_privilege('viewer', c.oid, 'UPDATE')
      or has_table_privilege('viewer', c.oid, 'DELETE') or has_table_privilege('viewer', c.oid, 'TRUNCATE'));
  if n_bad > 0 then raise exception 'viewer guard G2: % relations writable by viewer', n_bad; end if;

  -- G3 no VOLATILE function in public is executable by viewer (sim 73 also keeps PUBLIC at zero).
  --    Trade-AI functions keep their own ACL (rule 7): reachable only through PUBLIC, exactly as
  --    by the admin's own session, so the viewer gains nothing there.
  select count(*) into n_bad from pg_proc p
  --    Extension members are skipped like in 5d (they keep PUBLIC by design): a pg_trgm or vector
  --    installed in public on the remote would otherwise abort the sync here.
  where p.pronamespace = 'public'::regnamespace and p.provolatile = 'v'
    and p.oid not in (select t.oid from _trade_ai t where t.cat = 'pg_proc'::regclass)
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('viewer', p.oid, 'EXECUTE');
  if n_bad > 0 then raise exception 'viewer guard G3: % volatile public functions executable by viewer', n_bad; end if;

  -- G4 the PUBLIC revoke changed nothing for anon/authenticated/service_role.
  select count(*) into n_bad from _exec_before b
  where b.can <> has_function_privilege(b.rolname, b.oid, 'EXECUTE');
  if n_bad > 0 then raise exception 'viewer guard G4: % API-role EXECUTE privileges changed', n_bad; end if;

  -- G5 every SELECT/ALL policy that applies to authenticated also applies to viewer.
  select count(*) into n_bad from pg_policy pol join pg_class c on c.oid = pol.polrelid
  where c.relnamespace = 'public'::regnamespace
    and c.oid not in (select t.oid from _trade_ai t where t.cat = 'pg_class'::regclass)
    and pol.polcmd in ('r', '*') and 'authenticated'::regrole = any (pol.polroles)
    and not 'viewer'::regrole = any (pol.polroles);
  if n_bad > 0 then raise exception 'viewer guard G5: % policies miss viewer', n_bad; end if;

  -- G7 hard rule 7: no Trade-AI relation gained a viewer grant or a viewer policy.
  select count(*) into n_bad from _trade_ai t
  where t.cat = 'pg_class'::regclass
    and (exists (select 1 from pg_class c, aclexplode(c.relacl) x where c.oid = t.oid and x.grantee = 'viewer'::regrole)
      or exists (select 1 from pg_policy pol where pol.polrelid = t.oid and 'viewer'::regrole = any (pol.polroles)));
  if n_bad > 0 then raise exception 'viewer guard G7: % Trade-AI relations touched', n_bad; end if;

  -- G6 viewer inherits nothing.
  if exists (select 1 from pg_auth_members where member = 'viewer'::regrole)
     or (select rolcanlogin or rolinherit or rolbypassrls or rolsuper from pg_roles where rolname = 'viewer') then
    raise exception 'viewer guard G6: viewer must be NOLOGIN NOINHERIT, member of no role';
  end if;

  raise notice 'viewer: % relations granted, % policies extended, % session-live policies, % functions lost PUBLIC, % allowlisted',
    n_grants, n_policies, n_live, n_revoked, n_allow;
end $$;
