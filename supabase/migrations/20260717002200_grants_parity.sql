-- Grants parity / reproducibility hardening.
-- The app relied on Supabase's PLATFORM default-privileges (anon/authenticated get
-- table DML, RLS gates the rows) that were never captured in migrations. A fresh DB
-- — a local `supabase start`, or a brand-new remote project — therefore comes up
-- BROKEN: authenticated has only TRUNCATE/REFERENCES/TRIGGER, so every RLS-scoped
-- SELECT/INSERT is denied at the grant layer before RLS is even consulted. Make the
-- grants explicit and reproducible.
--
-- RLS stays the real row-level boundary; these are table/usage grants only.
-- Function EXECUTE grants are left exactly as each migration set them — the internal
-- security-definer RPCs (dispatch_order, expire_*, refresh_prep_stats,
-- courier_dispatch_distance_m, nearby_available_couriers) KEEP their REVOKEs.
-- Trade-AI tables on the shared remote are excluded (rule: never touch them); on a
-- fresh remote sync the app-table grants are idempotent with the platform defaults.

grant usage on schema public to anon, authenticated, service_role;

-- Explicit per-table grants, skipping any dormant Trade-AI tables.
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not similar to '(poly|polymarket|gladiator|equity_history|syndicate_audits)%'
  loop
    execute format('grant all on public.%I to anon, authenticated, service_role', t.tablename);
  end loop;
end $$;

-- Sequences and routines one by one with the same Trade-AI exclusion (hard rule 7): the schema-wide
-- `grant ... on all sequences / all routines` rewrote their ACLs on the remote sync too. Edited in
-- place before any remote sync (verifier round 2, 2026-10-04); locally the result is identical.
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as seq from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
      and c.relname not similar to '(poly|polymarket|gladiator|equity_history|syndicate_audits)%'
  loop
    execute format('grant all on sequence %s to anon, authenticated, service_role', r.seq);
  end loop;
  for r in
    select p.oid::regprocedure as fn from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname not similar to '(poly|polymarket|gladiator)%'
  loop
    execute format('grant execute on routine %s to service_role', r.fn); -- service_role bypasses RLS anyway
  end loop;
end $$;

-- Future app tables/sequences inherit the same posture (matches Supabase defaults).
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

-- PostGIS lives in the extensions schema; the invoker RPC nearby_restaurants (and
-- any client using geo) needs USAGE + EXECUTE there. spatial_ref_sys read for SRID.
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;
grant select on all tables in schema extensions to anon, authenticated, service_role;
