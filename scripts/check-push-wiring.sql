-- Deploy gate: is push delivery wired for a HOSTED database?
-- pg_cron drains notification_outbox by calling app.push_drain_url with app.push_drain_secret
-- (pg_net). Locally that URL is http://host.docker.internal:3007/..., which a hosted Supabase
-- can never reach: on staging/prod every push would fail and nobody would see it.
-- Run against the TARGET database before calling it ready (it fails locally, by design):
--   psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-push-wiring.sql
-- Prints the host only, never the secret. Not part of `npm run verify` (that measures local).
do $$
declare
  v_url text := nullif(current_setting('app.push_drain_url', true), '');
  v_secret text := nullif(current_setting('app.push_drain_secret', true), '');
  v_host text := substring(v_url from '^[a-z]+://([^/:]+)');
begin
  if v_url is null then
    raise exception 'FAIL push wiring: app.push_drain_url is not set (pushes never leave the outbox)';
  end if;
  if v_host is null or v_host in ('host.docker.internal', 'localhost', '127.0.0.1', '0.0.0.0') then
    raise exception 'FAIL push wiring: app.push_drain_url points at % — unreachable from a hosted database', coalesce(v_host, v_url);
  end if;
  if v_url not like 'https://%' then
    raise exception 'FAIL push wiring: app.push_drain_url must be https (host %)', v_host;
  end if;
  if v_secret is null or length(v_secret) < 24 then
    raise exception 'FAIL push wiring: app.push_drain_secret missing or shorter than 24 characters';
  end if;
  raise notice 'PASS push wiring: drain at https://% with a secret set', v_host;
end $$;
