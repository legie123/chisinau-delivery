-- A courier can release an accepted order BEFORE pickup, within a daily cap (system scenario 5; owner decision
-- 2026-10-12: "înainte de ridicare, fără penalizare, cu plafon zilnic").
--
-- Before: once accepted, only an admin could take an order off a courier (admin_reassign_courier); a courier with
-- a flat tyre had to phone and the food waited. Now:
-- - courier_release_order(order, reason): only the active courier assigned to the order, only while it is
--   courier_assigned (after pickup the food is with the courier: support only), at most
--   courier_release_policy.daily_cap releases per courier per Chisinau calendar day. The order goes back to
--   ready_for_pickup with no courier, the courier back online, an event lands in the timeline, and the order is
--   re-dispatched at once — never to the same courier (dispatch_order already skips a courier whose offer for the
--   order is accepted). A dispatch failure is recorded in dispatch_errors, never raised at the courier.
-- - NO penalty anywhere: releases are not read by dispatch_order or any score (EU 2024/2831, see
--   docs/plan/CONSTRANGERI-GAMIFICARE.md). They are visible to the courier (own) and to platform_admin.
-- - courier_release_policy: versioned + immutable like the other business configs; daily_cap 3 is PROVISIONAL
--   (the owner's example); a new value is a new row through set_courier_release_policy (platform_admin only).
-- - courier_order_releases: append-only, reason from a fixed list, no free text (no personal data).
-- ROLLBACK: supabase/rollbacks/20261012000209_courier_release_order.down.sql

create table public.courier_release_policy (
  id uuid primary key default gen_random_uuid(),
  effective_from timestamptz not null default now(),
  daily_cap integer not null check (daily_cap between 0 and 20),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
insert into public.courier_release_policy (effective_from, daily_cap, note)
values ('2026-01-01T00:00:00Z', 3, 'PROVIZORIU: exemplul owner-ului 2026-10-12 (3 renunțări pe zi), de ratificat');

create or replace function public.guard_courier_release_policy_immutable()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  raise exception 'courier_release_policy is versioned: add a new row, never edit or delete one';
end;
$$;
-- a trigger function needs no EXECUTE grant to fire; a new function is executable by PUBLIC until revoked (sim 73.a3)
revoke all on function public.guard_courier_release_policy_immutable() from public, anon, authenticated;
create trigger guard_courier_release_policy_immutable
  before update or delete on public.courier_release_policy
  for each row execute function public.guard_courier_release_policy_immutable();

alter table public.courier_release_policy enable row level security;
revoke all on table public.courier_release_policy from public, anon, authenticated, viewer;
grant select on table public.courier_release_policy to authenticated, viewer;
create policy courier_release_policy_read on public.courier_release_policy
  for select to authenticated, viewer using (true);
create policy viewer_session_live on public.courier_release_policy
  as restrictive for select to viewer using ((select public.viewer_session_live()));

create or replace function public.current_courier_release_policy()
returns public.courier_release_policy
language sql stable security definer set search_path = 'public' as $$
  select * from public.courier_release_policy where effective_from <= now() order by effective_from desc limit 1;
$$;
revoke all on function public.current_courier_release_policy() from public, anon;
grant execute on function public.current_courier_release_policy() to authenticated;

create or replace function public.set_courier_release_policy(p_daily_cap integer, p_note text default null)
returns void language plpgsql security definer set search_path = 'public', 'auth' as $$
begin
  if not public.has_role('platform_admin') then raise exception 'not authorized'; end if;
  insert into public.courier_release_policy (daily_cap, note, created_by) values (p_daily_cap, p_note, auth.uid());
end;
$$;
revoke all on function public.set_courier_release_policy(integer, text) from public, anon;
grant execute on function public.set_courier_release_policy(integer, text) to authenticated;

create table public.courier_order_releases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  courier_id uuid not null references public.couriers(id) on delete cascade,
  reason text not null check (reason in ('vehicle_problem', 'personal_emergency', 'restaurant_delay', 'other')),
  created_at timestamptz not null default now()
);
create index courier_order_releases_courier_idx on public.courier_order_releases (courier_id, created_at desc);
alter table public.courier_order_releases enable row level security;
revoke all on table public.courier_order_releases from public, anon, authenticated, viewer;
grant select on table public.courier_order_releases to authenticated, viewer;
create policy courier_order_releases_courier_read on public.courier_order_releases
  for select to authenticated, viewer using (courier_id = (select public.current_courier_id()));
create policy courier_order_releases_admin_read on public.courier_order_releases
  for select to authenticated, viewer using ((select public.has_role('platform_admin')));
create policy viewer_session_live on public.courier_order_releases
  as restrictive for select to viewer using ((select public.viewer_session_live()));

-- a re-dispatch failure after a release is recorded like the sweeper's (dispatch_errors is CURIER's, a18b8aa)
alter table public.dispatch_errors drop constraint dispatch_errors_phase_check,
  add constraint dispatch_errors_phase_check check (phase in ('expire', 'sweep', 'release'));

create or replace function public.courier_release_order(p_order_id uuid, p_reason text)
returns integer   -- releases left today after this one
language plpgsql
security definer
set search_path = 'public', 'auth'
as $$
declare
  v_courier uuid;
  v_order public.orders%rowtype;
  v_cap integer;
  v_used integer;
begin
  select id into v_courier from public.couriers where user_id = auth.uid() and is_active;
  if v_courier is null then raise exception 'Doar un curier activ poate renunța la o comandă.'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.courier_id is distinct from v_courier then
    raise exception 'Comanda nu îți este atribuită.';
  end if;
  if v_order.status in ('picked_up', 'en_route') then
    raise exception 'Comanda e deja ridicată: renunțarea se face doar prin suport.';
  end if;
  if v_order.status <> 'courier_assigned' then
    raise exception 'Comanda nu mai este activă.';
  end if;
  if p_reason is null or p_reason not in ('vehicle_problem', 'personal_emergency', 'restaurant_delay', 'other') then
    raise exception 'Alege motivul renunțării.';
  end if;

  select daily_cap into v_cap from public.current_courier_release_policy();
  perform 1 from public.couriers where id = v_courier for update;   -- serialises two releases by one courier
  select count(*) into v_used from public.courier_order_releases r
   where r.courier_id = v_courier
     and r.created_at >= (date_trunc('day', now() at time zone 'Europe/Chisinau') at time zone 'Europe/Chisinau');
  if v_used >= coalesce(v_cap, 0) then
    raise exception 'Ai atins limita de % renunțări pe azi. Sună la suport.', coalesce(v_cap, 0);
  end if;

  insert into public.courier_order_releases (order_id, courier_id, reason) values (p_order_id, v_courier, p_reason);
  update public.orders
     set status = 'ready_for_pickup', courier_id = null, courier_arrived_restaurant_at = null
   where id = p_order_id;
  update public.couriers set status = 'online' where id = v_courier and status = 'on_delivery';
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'ready_for_pickup', 'courier', auth.uid());

  begin
    perform public.dispatch_order(p_order_id);
  exception when others then
    insert into public.dispatch_errors (order_id, phase, error_code, message)
    values (p_order_id, 'release', sqlstate, sqlerrm)
    on conflict (order_id, error_code) do update
      set count = public.dispatch_errors.count + 1, last_at = now(),
          message = excluded.message, phase = excluded.phase;
  end;

  return coalesce(v_cap, 0) - v_used - 1;
end;
$$;
revoke all on function public.courier_release_order(uuid, text) from public, anon;
grant execute on function public.courier_release_order(uuid, text) to authenticated;
