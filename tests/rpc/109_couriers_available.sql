-- 109: empty state "no couriers" (parity row, migration 20261012000106). couriers_available() tells
-- the customer app whether ANY active courier is online, as a single boolean (no count, no identity,
-- no position), so Home can say "toți curierii sunt ocupați" before the customer orders. Authenticated
-- only. Discovery RPC = CLIENT's.
do $$
declare v_any boolean;
begin
  -- 109.1 nobody online -> false
  update public.couriers set status = 'offline';
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  if public.couriers_available() then raise exception 'FAIL 109.1: true with every courier offline'; end if;
  -- 109.2 one active courier online -> true; an inactive one does not count
  update public.couriers set status = 'online', is_active = false where id = (select id from public.couriers order by created_at limit 1);
  if public.couriers_available() then raise exception 'FAIL 109.2: an inactive (suspended) courier counted'; end if;
  update public.couriers set is_active = true where id = (select id from public.couriers order by created_at limit 1);
  if not public.couriers_available() then raise exception 'FAIL 109.2: false with an active courier online'; end if;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS 109.1-2: true only when an active courier is online';
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.couriers_available()', 'execute') then
    raise exception 'FAIL 109.3: anon can execute couriers_available';
  end if;
  if (select prorettype::regtype::text from pg_proc where proname = 'couriers_available') <> 'boolean' then
    raise exception 'FAIL 109.3: couriers_available must return a bare boolean';
  end if;
  raise notice 'PASS 109.3: authenticated only, returns a boolean and nothing else';
end $$;
