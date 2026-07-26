-- Order 1 (pilot-critical) — COURIER CASH FLOAT for the COD-only pilot.
--
-- Couriers collect cash on delivery (cash + card_on_delivery both settle
-- in-hand today; only true CASH is a platform liability — card_on_delivery is
-- captured on a POS terminal and settles electronically, it never sits in the
-- courier's pocket). Unbounded cash-in-hand is a real robbery/embezzlement
-- risk once volume grows, so: (1) every cash collection is an append-only
-- ledger entry, (2) a courier is blocked from going back online once their
-- float nears the cap until they hand it in, (3) an admin can read every
-- courier's balance and record an offload.
--
-- Design mirrors two already-shipped patterns verbatim:
--   - cash_policy: versioned + immutable history, exactly like pricing_config
--     (20260727000400) — the provisional numbers are seeded as v1, retunable
--     only via a new version (set_cash_policy), never a silent edit.
--   - courier_cash_movements: RPC-only append-only ledger, exactly like
--     delivery_status_events/ratings (no insert/update/delete policy; writes
--     happen only inside SECURITY DEFINER functions) PLUS an explicit
--     before-update-or-delete trigger (belt & suspenders — the CHECK below
--     also blocks non-conforming rows even from a superuser test harness).

-- ---------------------------------------------------------------------------
-- 1. cash_policy — versioned, immutable. "internal reader" only: couriers and
--    admins never query this table directly, they go through
--    get_courier_cash_status()/admin_courier_cash_status() which fold in the
--    live balance too.
-- ---------------------------------------------------------------------------
create table if not exists public.cash_policy (
  id uuid primary key default gen_random_uuid(),
  effective_from timestamptz not null default now(),
  cap_mdl numeric(8,2) not null check (cap_mdl > 0),
  reactivation_threshold_mdl numeric(8,2) not null check (reactivation_threshold_mdl > 0 and reactivation_threshold_mdl <= cap_mdl),
  offload_channel_text text not null check (btrim(offload_channel_text) <> ''),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.cash_policy enable row level security;
-- No select/insert/update/delete policy at all — this is an internal table.
-- Every SECURITY DEFINER function below is owned by the migration role
-- (superuser) and bypasses RLS entirely, same access model as
-- delivery_status_events ("deliberately NO insert policy — only RPCs write").

-- Seed v1 = the provisional founder numbers, labeled for ratification.
insert into public.cash_policy (effective_from, cap_mdl, reactivation_threshold_mdl, offload_channel_text, note)
select '2026-01-01T00:00:00Z', 1500.00, 1000.00,
       'Predă numerarul la sediul Dragon Courier — zilnic 09:00–21:00',
       'provizoriu — de ratificat'
where not exists (select 1 from public.cash_policy);

-- The policy effective right now. Internal reader — ungranted (mirrors
-- courier_cash_balance below): only called from other SECURITY DEFINER
-- functions in this file, which run as the (superuser) owner regardless.
create or replace function public.current_cash_policy()
returns public.cash_policy
language sql stable security definer set search_path = public
as $$
  select * from public.cash_policy where effective_from <= now() order by effective_from desc limit 1;
$$;
revoke execute on function public.current_cash_policy() from public, anon, authenticated;

-- A published cap version is immutable — retuning is a NEW row, never an edit.
create or replace function public.guard_cash_policy_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'cash_policy este imutabil — o schimbare de plafon se face cu o versiune nouă (set_cash_policy)';
end;
$$;
drop trigger if exists guard_cash_policy_immutable on public.cash_policy;
create trigger guard_cash_policy_immutable
  before update or delete on public.cash_policy
  for each row execute function public.guard_cash_policy_immutable();

-- The versioned setter — admin-only, appends a new immutable version.
create or replace function public.set_cash_policy(
  p_cap_mdl numeric, p_reactivation_mdl numeric, p_offload_text text,
  p_effective_from timestamptz default now(), p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  if p_cap_mdl is null or p_cap_mdl <= 0 then raise exception 'plafonul trebuie să fie pozitiv'; end if;
  if p_reactivation_mdl is null or p_reactivation_mdl <= 0 or p_reactivation_mdl > p_cap_mdl then
    raise exception 'pragul de reactivare trebuie să fie pozitiv și sub plafon';
  end if;
  if p_offload_text is null or btrim(p_offload_text) = '' then raise exception 'canalul de predare este obligatoriu'; end if;

  insert into public.cash_policy (effective_from, cap_mdl, reactivation_threshold_mdl, offload_channel_text, note, created_by)
  values (p_effective_from, p_cap_mdl, p_reactivation_mdl, btrim(p_offload_text), p_note, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function public.set_cash_policy(numeric, numeric, text, timestamptz, text) from public, anon;
grant execute on function public.set_cash_policy(numeric, numeric, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. courier_cash_movements — append-only ledger. RPC-only writes: the
--    accrual hook inside advance_delivery_status (below) and
--    record_cash_offload (below). No insert/update/delete policy; a trigger
--    additionally raises on UPDATE/DELETE (defense-in-depth vs a superuser
--    context, e.g. a test harness or a future service-role script).
-- ---------------------------------------------------------------------------
create table if not exists public.courier_cash_movements (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  kind text not null check (kind in ('collected', 'offload')),
  amount_mdl numeric(10,2) not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'collected' and amount_mdl > 0) or (kind = 'offload' and amount_mdl < 0))
);
create index if not exists courier_cash_movements_courier_idx on public.courier_cash_movements (courier_id, created_at desc);

alter table public.courier_cash_movements enable row level security;
drop policy if exists courier_cash_movements_self_read on public.courier_cash_movements;
create policy courier_cash_movements_self_read on public.courier_cash_movements
  for select using (courier_id = public.current_courier_id());
drop policy if exists courier_cash_movements_admin_read on public.courier_cash_movements;
create policy courier_cash_movements_admin_read on public.courier_cash_movements
  for select using (has_role('platform_admin'));

revoke all on public.courier_cash_movements from anon;
grant select on public.courier_cash_movements to authenticated;

-- Append-only for every MONEY field. The one narrow exception: orders.id has
-- `courier_cash_movements.order_id references orders(id) on delete set null`
-- for referential integrity — if an order row is ever removed (not a normal
-- path today, but tests/rpc/10_transitions_contract.sql's probe cleanup does
-- it), Postgres performs that as a real UPDATE ... SET order_id = NULL on this
-- table. That housekeeping touches nothing money-relevant, so it's let
-- through; every other UPDATE, and every DELETE, still raises.
create or replace function public.guard_cash_movements_append_only()
returns trigger language plpgsql set search_path = public
as $$
begin
  if TG_OP = 'UPDATE'
     and NEW.order_id is null and OLD.order_id is not null
     and NEW.courier_id = OLD.courier_id and NEW.kind = OLD.kind and NEW.amount_mdl = OLD.amount_mdl
     and NEW.note is not distinct from OLD.note and NEW.created_by is not distinct from OLD.created_by
     and NEW.created_at = OLD.created_at then
    return new; -- FK ON DELETE SET NULL cleanup only — no money field touched
  end if;
  raise exception 'courier_cash_movements este append-only — nicio modificare/ștergere permisă';
end;
$$;
drop trigger if exists guard_cash_movements_append_only on public.courier_cash_movements;
create trigger guard_cash_movements_append_only
  before update or delete on public.courier_cash_movements
  for each row execute function public.guard_cash_movements_append_only();

-- Internal reader — sum of movements. UNGRANTED: only other SECURITY DEFINER
-- functions in this file call it.
create or replace function public.courier_cash_balance(p_courier_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(amount_mdl), 0) from public.courier_cash_movements where courier_id = p_courier_id;
$$;
revoke execute on function public.courier_cash_balance(uuid) from public, anon, authenticated;

-- Auto-offline the instant a cash collection pushes a courier's float to (or
-- past) the cap — fires regardless of which path inserted the accrual row, so
-- the safety property doesn't depend on advance_delivery_status remembering
-- to enforce it. Also ends any open shift + declines a live dispatch offer,
-- same cleanup set_courier_online_status('offline') already does, so the
-- courier isn't left "online" in name only.
create or replace function public.enforce_cash_cap_offline()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_balance numeric; v_cap numeric;
begin
  v_balance := public.courier_cash_balance(new.courier_id);
  select cap_mdl into v_cap from public.current_cash_policy();
  if v_cap is not null and v_balance >= v_cap then
    update public.couriers set status = 'offline' where id = new.courier_id and status <> 'offline';
    update public.courier_shifts set ended_at = now() where courier_id = new.courier_id and ended_at is null;
    update public.dispatch_offers set status = 'declined', responded_at = now()
      where courier_id = new.courier_id and status = 'offered';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_cash_cap_offline on public.courier_cash_movements;
create trigger enforce_cash_cap_offline
  after insert on public.courier_cash_movements
  for each row when (new.kind = 'collected')
  execute function public.enforce_cash_cap_offline();

-- ---------------------------------------------------------------------------
-- 3. Read surfaces — courier self + admin. Same shape, different auth gate.
-- ---------------------------------------------------------------------------
create or replace function public.get_courier_cash_status()
returns table (
  balance_mdl numeric,
  cap_mdl numeric,
  reactivation_threshold_mdl numeric,
  offload_channel_text text
)
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_courier_id uuid := public.current_courier_id();
  v_policy public.cash_policy;
begin
  if v_courier_id is null then raise exception 'not a courier'; end if;
  v_policy := public.current_cash_policy();
  return query select public.courier_cash_balance(v_courier_id), v_policy.cap_mdl, v_policy.reactivation_threshold_mdl, v_policy.offload_channel_text;
end;
$$;
revoke execute on function public.get_courier_cash_status() from public, anon;
grant execute on function public.get_courier_cash_status() to authenticated;

create or replace function public.admin_courier_cash_status(p_courier_id uuid)
returns table (
  balance_mdl numeric,
  cap_mdl numeric,
  reactivation_threshold_mdl numeric,
  offload_channel_text text
)
language plpgsql security definer set search_path = public, auth
as $$
declare v_policy public.cash_policy;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  v_policy := public.current_cash_policy();
  return query select public.courier_cash_balance(p_courier_id), v_policy.cap_mdl, v_policy.reactivation_threshold_mdl, v_policy.offload_channel_text;
end;
$$;
revoke execute on function public.admin_courier_cash_status(uuid) from public, anon;
grant execute on function public.admin_courier_cash_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_cash_offload — human admin only (mirrors suspend_courier). The
--    admin types a POSITIVE amount handed over; the ledger stores it negative
--    (the CHECK on the table enforces the sign).
-- ---------------------------------------------------------------------------
create or replace function public.record_cash_offload(p_courier_id uuid, p_amount_mdl numeric, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  if p_amount_mdl is null or p_amount_mdl <= 0 then raise exception 'suma trebuie să fie pozitivă'; end if;
  if not exists (select 1 from public.couriers where id = p_courier_id) then raise exception 'courier not found'; end if;

  insert into public.courier_cash_movements (courier_id, kind, amount_mdl, note, created_by)
  values (p_courier_id, 'offload', -p_amount_mdl, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function public.record_cash_offload(uuid, numeric, text) from public, anon;
grant execute on function public.record_cash_offload(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. advance_delivery_status — recreated from its CURRENT live body
--    (20260726000000_checkout_idempotency's version: p_order_id, p_new_status,
--    p_payment_confirmed) with ONLY the accrual insert added. Placed AFTER the
--    existing "delivered -> courier back online" line so that, when this
--    delivery tips the float over the cap, enforce_cash_cap_offline's
--    "set status = offline" (fired by the accrual INSERT below) is the last
--    write and wins — never silently re-flipped back online.
-- ---------------------------------------------------------------------------
create or replace function public.advance_delivery_status(p_order_id uuid, p_new_status text, p_payment_confirmed boolean default null)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_allowed text[];
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.courier_id not in (select id from public.couriers where user_id = auth.uid()) and not has_role('platform_admin') then
    raise exception 'not authorized';
  end if;

  if v_order.status = p_new_status then return; end if; -- idempotent retry

  v_allowed := case v_order.status
    when 'courier_assigned' then array['picked_up']
    when 'picked_up' then array['en_route']
    when 'en_route' then array['delivered']
    else array[]::text[]
  end;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'invalid transition % -> %', v_order.status, p_new_status;
  end if;

  -- MONEY GATE: a prepaid (online) order must be paid before it is handed over.
  if p_new_status = 'delivered'
     and v_order.payment_method = 'online_gateway'
     and v_order.payment_status <> 'paid' then
    raise exception 'online order % cannot be delivered before payment is confirmed (payment_status=%)',
      v_order.order_number, v_order.payment_status;
  end if;

  update public.orders
  set status = p_new_status,
      delivered_at = case when p_new_status = 'delivered' then now() else delivered_at end,
      payment_status = case
        when p_new_status = 'delivered' and p_payment_confirmed and payment_method <> 'online_gateway' then 'paid'
        else payment_status
      end
  where id = p_order_id;

  if p_new_status = 'delivered' then
    update public.couriers set status = 'online' where id = v_order.courier_id;
  end if;

  -- CASH FLOAT accrual (order 1 — COD-only pilot). ONLY payment_method='cash'
  -- accrues a liability: card_on_delivery settles electronically on a POS
  -- terminal and never sits in the courier's pocket. If this pushes the
  -- courier's float to/past the cap, enforce_cash_cap_offline (trigger on
  -- courier_cash_movements) forces them back offline right here.
  if p_new_status = 'delivered' and p_payment_confirmed and v_order.payment_method = 'cash' and v_order.total_mdl > 0 then
    insert into public.courier_cash_movements (courier_id, order_id, kind, amount_mdl)
    values (v_order.courier_id, v_order.id, 'collected', v_order.total_mdl);
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, p_new_status, case when has_role('courier') then 'courier' else 'platform_admin' end, auth.uid());
end;
$$;
-- Grants unchanged from 20260726000000_checkout_idempotency.sql (CREATE OR
-- REPLACE preserves them), restated here for anyone reading migrations
-- top-to-bottom:
revoke execute on function public.advance_delivery_status(uuid, text, boolean) from public, anon;
grant execute on function public.advance_delivery_status(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. set_courier_online_status — recreated from its CURRENT live body
--    (20260727000700_courier_pilot_kpis's version, which opens/closes
--    courier_shifts) with ONLY the cash-cap gate added on the online branch.
--    The gate compares against the LOWER reactivation threshold, not the cap
--    itself — hysteresis: a courier auto-offlined at the cap (1500) can only
--    come back once they've paid down below the reactivation threshold
--    (1000), not merely below the cap, so they can't flap online/offline by
--    handing in one MDL. Since cap >= reactivation_threshold always (table
--    CHECK), "balance >= cap" always implies "balance >= reactivation
--    threshold", so the gate still blocks at the cap as required.
-- ---------------------------------------------------------------------------
create or replace function public.set_courier_online_status(p_status text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_courier public.couriers%rowtype;
  v_policy public.cash_policy;
begin
  if p_status not in ('offline', 'online') then raise exception 'invalid status'; end if;
  select * into v_courier from public.couriers where user_id = auth.uid() and is_active for update;
  if not found then raise exception 'not an active courier'; end if;
  -- #30: mid-delivery state is owned by the order lifecycle, not the toggle.
  if v_courier.status = 'on_delivery' then
    raise exception 'ai o livrare activă — finalizeaz-o înainte să schimbi statusul';
  end if;

  -- Idempotent no-op on a redundant toggle (e.g. two tabs) — must NOT open a
  -- second shift or double-close the current one.
  if v_courier.status = p_status then
    return;
  end if;

  if p_status = 'online' then
    -- Cash float hard cap gate (order 1). Compares against the LOWER
    -- reactivation threshold, not the cap — see header comment.
    v_policy := public.current_cash_policy();
    if v_policy is not null and public.courier_cash_balance(v_courier.id) >= v_policy.reactivation_threshold_mdl then
      raise exception 'Plafon numerar atins — predă încasările înainte să revii online.';
    end if;
    insert into public.courier_shifts (courier_id, started_at) values (v_courier.id, now());
  else
    update public.courier_shifts set ended_at = now()
    where courier_id = v_courier.id and ended_at is null;
  end if;

  update public.couriers set status = p_status where id = v_courier.id;
  -- #52: going dark declines any live offer; the expire sweeper re-dispatches.
  if p_status = 'offline' then
    update public.dispatch_offers set status = 'declined', responded_at = now()
    where courier_id = v_courier.id and status = 'offered';
  end if;
end;
$$;
-- Grants unchanged from 20260727000700_courier_pilot_kpis.sql:
revoke execute on function public.set_courier_online_status(text) from public, anon;
grant execute on function public.set_courier_online_status(text) to authenticated;
