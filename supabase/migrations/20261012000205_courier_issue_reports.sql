-- Courier issue reports: "I'm running late", "the order isn't ready", "I can't find the restaurant",
-- "the customer doesn't answer", "the address is wrong" (parity gap: LIPSA in the CURIER matrix).
--
-- Before: the courier app had no way to say anything went wrong; an unreachable customer left the order
-- 'en_route' until an admin noticed. Now the assigned courier files a typed report, ops can read it.
--
-- Shape:
-- - delivery_issue_reports: append-only (no UPDATE/DELETE for clients), one row per (order, kind) so a
--   retry or a nervous double tap never stacks duplicates. No free text on purpose: nothing typed by a
--   courier can carry personal data, so nothing new for purge_expired_pii.
-- - courier_report_issue(order, kind): security definer, checks BOTH the caller (active courier assigned
--   to this order) and the transition (order still active; the kind fits the leg: restaurant problems
--   only before pickup, customer problems only after it, "running late" on both).
-- - Read: the courier their own rows, platform_admin all (same pattern as dispatch_offers, incl. the
--   viewer role and its live-session policy required by sim 73). Customers and restaurants: no access.
create table public.delivery_issue_reports (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  courier_id uuid not null references public.couriers(id) on delete cascade,
  kind text not null check (kind in ('running_late', 'restaurant_delayed', 'venue_not_found', 'customer_unreachable', 'address_wrong')),
  order_status text not null,
  created_at timestamptz not null default now(),
  unique (order_id, kind)
);
create index delivery_issue_reports_courier_idx on public.delivery_issue_reports (courier_id, created_at desc);

alter table public.delivery_issue_reports enable row level security;
revoke all on table public.delivery_issue_reports from public, anon, authenticated, viewer;
grant select on table public.delivery_issue_reports to authenticated, viewer;

create policy delivery_issue_reports_courier_read on public.delivery_issue_reports
  for select to authenticated, viewer
  using (courier_id = (select public.current_courier_id()));
create policy delivery_issue_reports_admin_read on public.delivery_issue_reports
  for select to authenticated, viewer
  using ((select public.has_role('platform_admin')));
create policy viewer_session_live on public.delivery_issue_reports
  as restrictive for select to viewer
  using ((select public.viewer_session_live()));

create or replace function public.courier_report_issue(p_order_id uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = 'public', 'auth'
as $$
declare
  v_courier uuid;
  v_order public.orders%rowtype;
  v_new uuid;
begin
  select id into v_courier from public.couriers where user_id = auth.uid() and is_active;
  if v_courier is null then raise exception 'Doar un curier activ poate raporta o problemă.'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.courier_id is distinct from v_courier then
    raise exception 'Comanda nu îți este atribuită.';
  end if;
  if v_order.status not in ('courier_assigned', 'picked_up', 'en_route') then
    raise exception 'Comanda nu mai este activă.';
  end if;

  if p_kind not in ('running_late', 'restaurant_delayed', 'venue_not_found', 'customer_unreachable', 'address_wrong') then
    raise exception 'Tip de problemă necunoscut.';
  end if;
  if p_kind in ('restaurant_delayed', 'venue_not_found') and v_order.status <> 'courier_assigned' then
    raise exception 'Problemele cu restaurantul se raportează înainte de ridicare.';
  end if;
  if p_kind in ('customer_unreachable', 'address_wrong') and v_order.status = 'courier_assigned' then
    raise exception 'Problemele cu clientul se raportează după ridicare.';
  end if;

  insert into public.delivery_issue_reports (order_id, courier_id, kind, order_status)
  values (p_order_id, v_courier, p_kind, v_order.status)
  on conflict (order_id, kind) do nothing
  returning id into v_new;
  return v_new is not null; -- false = already reported (idempotent retry)
end;
$$;

revoke all on function public.courier_report_issue(uuid, text) from public, anon;
grant execute on function public.courier_report_issue(uuid, text) to authenticated;

-- ROLLBACK (manual): drop function public.courier_report_issue(uuid, text);
--                    drop table public.delivery_issue_reports;
