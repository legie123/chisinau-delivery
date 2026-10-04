-- View-as ("vezi ca", 20261004000100): the `viewer` role is read-only BY THE DATABASE.
-- (a) catalog guards — fail the day a migration adds a table, policy or function without the
--     viewer in mind: SELECT parity with authenticated, zero write privilege, no VOLATILE public
--     function executable by viewer, no public function executable by PUBLIC, every SELECT/ALL
--     policy for authenticated also covers viewer, every readable RLS table requires a live session;
-- (b) as the seeded customer: viewer sees exactly the customer's orders (same ids as the
--     customer's own session), none of another customer's, may run the page read RPCs;
-- (c) every write is refused with insufficient_privilege: INSERT/UPDATE/DELETE and the
--     transition RPCs place_order / advance_delivery_status / accept_dispatch_offer /
--     set_order_tip / submit_rating;
-- (d) the session row gates it: unknown, ended or expired session → zero rows;
-- (e) start_view_as: platform_admin only, reason required, the target must own the surface.

do $$
declare
  v_bad text;
begin
  if to_regrole('viewer') is null or to_regclass('public.view_as_sessions') is null then
    raise exception 'FAIL 73.a0: viewer role / view_as_sessions missing (migration 20261004000100 not applied)';
  end if;

  select string_agg(c.relname, ', ') into v_bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege('authenticated', c.oid, 'SELECT') <> has_table_privilege('viewer', c.oid, 'SELECT');
  if v_bad is not null then raise exception 'FAIL 73.a1: SELECT differs between authenticated and viewer on: %', v_bad; end if;
  raise notice 'PASS 73.a1: viewer can SELECT exactly what authenticated can (public)';

  -- Every schema except `net`: pg_net ships its queue tables writable by PUBLIC (=arwdDxtm, anon
  -- included). Not reachable through the API (PostgREST exposes public + graphql_public only) and
  -- not the viewer's doing — but it is pre-existing, so it is named here instead of silenced.
  -- A table privilege is only usable with USAGE on its schema. Without that filter the check
  -- flagged cron.job_run_details (PUBLIC has DELETE there, but nobody below supabase_admin has
  -- USAGE on schema cron, RLS is on, and PostgREST does not expose it) — it only passed on clone
  -- DBs because pg_cron lives in the main DB alone (found when merging, 2026-10-04).
  select string_agg(c.oid::regclass::text, ', ') into v_bad from pg_class c
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and c.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace, 'net'::regnamespace)
    and has_schema_privilege('viewer', c.relnamespace, 'USAGE')
    and (has_table_privilege('viewer', c.oid, 'INSERT') or has_table_privilege('viewer', c.oid, 'UPDATE')
      or has_table_privilege('viewer', c.oid, 'DELETE') or has_table_privilege('viewer', c.oid, 'TRUNCATE'));
  if v_bad is not null then raise exception 'FAIL 73.a2: viewer can write: %', v_bad; end if;
  raise notice 'PASS 73.a2: zero usable INSERT/UPDATE/DELETE/TRUNCATE privilege for viewer (every schema it can reach, net named above)';

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.provolatile = 'v'
    and has_function_privilege('viewer', p.oid, 'EXECUTE');
  if v_bad is not null then raise exception 'FAIL 73.a3: VOLATILE functions executable by viewer: %', v_bad; end if;
  raise notice 'PASS 73.a3: viewer executes no VOLATILE public function';

  -- Postgres grants EXECUTE to PUBLIC on every new function: a migration that forgets
  -- `revoke execute ... from public` hands its function to the viewer. This is the tripwire.
  -- The fix needs BOTH lines: postgres-owned functions in public get no default grant to the API
  -- roles (pg_default_acl = {postgres=X}), so a bare revoke locks customers out with 42501.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('public', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'FAIL 73.a4: public functions executable by PUBLIC: % — fix: revoke execute on function <fn> from public; grant execute on function <fn> to <the roles that call it: anon / authenticated / service_role>', v_bad;
  end if;
  raise notice 'PASS 73.a4: no public function is executable by PUBLIC';

  select string_agg(pol.polrelid::regclass || '.' || pol.polname, ', ') into v_bad
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  where c.relnamespace = 'public'::regnamespace and pol.polcmd in ('r', '*')
    and 'authenticated'::regrole = any (pol.polroles) and not 'viewer'::regrole = any (pol.polroles);
  if v_bad is not null then raise exception 'FAIL 73.a5: SELECT/ALL policies without viewer: %', v_bad; end if;
  raise notice 'PASS 73.a5: every SELECT/ALL policy for authenticated also covers viewer';

  select string_agg(c.relname, ', ') into v_bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and has_table_privilege('viewer', c.oid, 'SELECT')
    and (not c.relrowsecurity or not exists (
      select 1 from pg_policy pol where pol.polrelid = c.oid and pol.polname = 'viewer_session_live'
        and not pol.polpermissive and pol.polcmd = 'r' and pol.polroles = array['viewer'::regrole::oid]));
  if v_bad is not null then raise exception 'FAIL 73.a6: readable by viewer without RLS + live-session policy: %', v_bad; end if;
  raise notice 'PASS 73.a6: every table viewer can read has RLS + the restrictive viewer_session_live policy';

  if exists (select 1 from pg_auth_members where member = 'viewer'::regrole)
     or (select rolcanlogin or rolinherit or rolbypassrls or rolsuper from pg_roles where rolname = 'viewer') then
    raise exception 'FAIL 73.a7: viewer must be NOLOGIN NOINHERIT, no BYPASSRLS, member of no role';
  end if;
  raise notice 'PASS 73.a7: viewer is NOLOGIN NOINHERIT and member of no role (inherits nothing)';
end $$;

do $$
declare
  c_admin constant uuid := 'a0000000-0000-0000-0000-000000000004';
  c_client constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_courier constant uuid := 'a0000000-0000-0000-0000-000000000002';
  v_sid uuid;
  v_other uuid;
  v_restaurant uuid;
  v_own text;
  v_seen text;
  v_n bigint;
  v_fn text;
begin
  perform set_config('search_path', 'public', true);
  select id into v_restaurant from public.restaurants order by created_at limit 1;
  select o.customer_id into v_other from public.orders o where o.customer_id <> c_client limit 1;

  -- the customer's own session: the reference row set
  perform set_config('request.jwt.claims', json_build_object('sub', c_client, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select coalesce(string_agg(id::text, ',' order by id), '') into v_own from public.orders;
  reset role;
  if v_own = '' then raise exception 'FAIL 73.b0: seeded customer has no orders — nothing to compare'; end if;

  -- (e) start_view_as authorization
  perform set_config('request.jwt.claims', json_build_object('sub', c_client, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_view_as(c_courier, 'curier', 'curiozitate');
    raise exception 'FAIL 73.e1: a customer started a view-as session';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_view_as(c_client, 'client', '  ');
    raise exception 'FAIL 73.e2: started without a reason';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.start_view_as(c_admin, 'client', 'admin pe admin');
    raise exception 'FAIL 73.e3: an admin was accepted as a target';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.start_view_as(c_client, 'curier', 'clientul nu e curier');
    raise exception 'FAIL 73.e4: target/app mismatch accepted';
  exception when invalid_parameter_value then null;
  end;
  v_sid := public.start_view_as(c_client, 'client', 'sim 73: suport comandă');
  reset role;
  if (select expires_at - started_at from public.view_as_sessions where id = v_sid) <> interval '15 minutes' then
    raise exception 'FAIL 73.e5: session is not 15 minutes';
  end if;
  raise notice 'PASS 73.e: start_view_as is platform_admin-only, needs a reason, rejects admin targets and wrong surfaces, lasts 15 min';

  -- (b) reads as the viewer of the customer
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_client, 'role', 'viewer', 'aud', 'authenticated', 'view_as_session', v_sid)::text, true);
  set local role viewer;
  select coalesce(string_agg(id::text, ',' order by id), '') into v_seen from public.orders;
  if v_seen <> v_own then raise exception 'FAIL 73.b1: viewer orders differ from the customer''s own'; end if;
  raise notice 'PASS 73.b1: viewer sees exactly the customer''s % orders', array_length(string_to_array(v_own, ','), 1);

  select count(*) into v_n from public.orders where customer_id = v_other;
  if v_other is not null and v_n <> 0 then raise exception 'FAIL 73.b2: viewer sees % orders of another customer', v_n; end if;
  select count(*) into v_n from public.view_as_sessions;
  if v_n <> 0 then raise exception 'FAIL 73.b3: viewer reads the view-as audit'; end if;
  perform * from public.get_prep_estimates(array[v_restaurant]);
  perform public.current_pricing_config();
  raise notice 'PASS 73.b2: no other customer''s orders, no audit rows; page read RPCs run';

  -- (c) every write refused
  begin
    insert into public.favorites (customer_id, restaurant_id) values (c_client, v_restaurant);
    raise exception 'FAIL 73.c1: viewer inserted a favorite';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set notes = 'x' where customer_id = c_client;
    raise exception 'FAIL 73.c2: viewer updated orders';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.favorites where customer_id = c_client;
    raise exception 'FAIL 73.c3: viewer deleted favorites';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 73.c1: INSERT/UPDATE/DELETE → permission denied';

  foreach v_fn in array array[
    'select public.place_order(null::uuid, null::text, null::text, null::jsonb, null::uuid, null::timestamptz, null::text, null::jsonb, null::text)',
    'select public.advance_delivery_status(null::uuid, null::text, null::boolean)',
    'select public.accept_dispatch_offer(null::uuid)',
    'select public.set_order_tip(null::uuid, 0::numeric)',
    'select public.submit_rating(null::uuid, null::text, 5, null::text)',
    'select public.start_view_as(null::uuid, ''client'', ''xxx'')',
    'select public.end_view_as(null::uuid)'
  ] loop
    begin
      execute v_fn;
      raise exception 'FAIL 73.c2: viewer executed: %', v_fn;
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'PASS 73.c2: place_order / advance_delivery_status / accept_dispatch_offer / set_order_tip / submit_rating / start_ / end_view_as → permission denied';
  reset role;

  -- (d) the session row gates the token
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_client, 'role', 'viewer', 'view_as_session', gen_random_uuid())::text, true);
  set local role viewer;
  select count(*) into v_n from public.orders;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 73.d1: unknown session still reads % orders', v_n; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', c_courier, 'role', 'viewer', 'view_as_session', v_sid)::text, true);
  set local role viewer;
  select count(*) into v_n from public.orders;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 73.d2: a session reused for another sub reads % orders', v_n; end if;

  update public.view_as_sessions set expires_at = now() - interval '1 second', started_at = now() - interval '16 minutes' where id = v_sid;
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_client, 'role', 'viewer', 'view_as_session', v_sid)::text, true);
  set local role viewer;
  select count(*) into v_n from public.orders;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 73.d3: expired session reads % orders', v_n; end if;
  update public.view_as_sessions set started_at = now(), expires_at = now() + interval '15 minutes' where id = v_sid;

  perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.end_view_as(v_sid);
  select count(*) into v_n from public.view_as_sessions where id = v_sid and ended_at is not null;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 73.d4: admin cannot see/end their own session'; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_client, 'role', 'viewer', 'view_as_session', v_sid)::text, true);
  set local role viewer;
  select count(*) into v_n from public.orders;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 73.d4: ended session still reads % orders', v_n; end if;
  raise notice 'PASS 73.d: unknown / other-sub / expired / ended session → zero rows';
end $$;
