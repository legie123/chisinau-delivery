-- DIRECTIVE 10 leftovers — cash-ops hardening (wave-1 shipped cash_policy +
-- ledger + gates in 20260727000800/000850). This migration:
--   (a) SINGLE SOURCE OF TRUTH: fold the hard-cap check into
--       courier_has_capacity() so DISPATCH also stops offering to a courier
--       at/above cap — today only the online toggle + accrual trigger gate it.
--   (b) TIERED CAP BY TENURE: a small STABLE fn effective_cash_cap(courier_id)
--       — couriers younger than 30 days get least(cap, 1000) instead of the
--       full cap (provizoriu — de ratificat, same "provisional" framing as
--       the seeded cash_policy row) — used by ALL cap checks: capacity fn,
--       online-toggle gate, accrual trigger.
--   (c) RECONCILIATION CRON: hourly job comparing each courier's ledger
--       balance vs an independent recompute from orders; drift > 50 MDL is a
--       signal only (fraud_flags row + admin notification), never blocks.
--
-- Index check (per directive): courier_cash_movements already has
-- courier_cash_movements_courier_idx btree(courier_id, created_at desc) from
-- 20260727000800 — covers courier_cash_balance()'s WHERE courier_id = ...
-- cheaply. Verified via \d in the local db; nothing to add.

-- ---------------------------------------------------------------------------
-- 1. effective_cash_cap — the single tiered-cap read. Internal-only (mirrors
--    courier_cash_balance/current_cash_policy): every caller below is itself
--    SECURITY DEFINER, so the revoke doesn't block them.
-- ---------------------------------------------------------------------------
create or replace function public.effective_cash_cap(p_courier_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.cash_policy;
  v_created_at timestamptz;
begin
  v_policy := public.current_cash_policy();
  if v_policy.cap_mdl is null then
    return null;
  end if;

  select created_at into v_created_at from public.couriers where id = p_courier_id;

  -- provizoriu — de ratificat: curierii sub 30 zile vechime au plafon redus.
  if v_created_at is not null and v_created_at > now() - interval '30 days' then
    return least(v_policy.cap_mdl, 1000);
  end if;

  return v_policy.cap_mdl;
end;
$$;
revoke execute on function public.effective_cash_cap(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. courier_has_capacity — recreated from its CURRENT live body (unchanged
--    single-active-order check) + the cash-cap gate folded in, so this is
--    once again the single capacity source dispatch_order() already calls.
--    Structural change: was `language sql stable` (no SECURITY DEFINER,
--    execute left open to PUBLIC by the original migration) — it must now be
--    SECURITY DEFINER to reach effective_cash_cap/courier_cash_balance
--    (both revoked from authenticated); it returns a boolean flag only, no
--    row data, so bypassing RLS here doesn't leak anything. Grants unchanged
--    (PUBLIC execute, never revoked in 20260717001600_dispatch_offers.sql).
-- ---------------------------------------------------------------------------
create or replace function public.courier_has_capacity(p_courier_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cap numeric;
begin
  if exists (
    select 1 from public.orders
    where courier_id = p_courier_id
      and status in ('courier_assigned', 'picked_up', 'en_route')
  ) then
    return false;
  end if;

  v_cap := public.effective_cash_cap(p_courier_id);
  if v_cap is not null and public.courier_cash_balance(p_courier_id) >= v_cap then
    return false;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. enforce_cash_cap_offline — recreated from its CURRENT body (20260727000800)
--    swapping the literal `select cap_mdl into v_cap from current_cash_policy()`
--    read for effective_cash_cap(new.courier_id), so a courier under 30 days
--    is force-offlined at their tiered cap (1000), not the flat 1500.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_cash_cap_offline()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_balance numeric; v_cap numeric;
begin
  v_balance := public.courier_cash_balance(new.courier_id);
  v_cap := public.effective_cash_cap(new.courier_id);
  if v_cap is not null and v_balance >= v_cap then
    update public.couriers set status = 'offline' where id = new.courier_id and status <> 'offline';
    update public.courier_shifts set ended_at = now() where courier_id = new.courier_id and ended_at is null;
    update public.dispatch_offers set status = 'declined', responded_at = now()
      where courier_id = new.courier_id and status = 'offered';
  end if;
  return new;
end;
$$;
-- Trigger binding (enforce_cash_cap_offline on courier_cash_movements after
-- insert) is unaffected by CREATE OR REPLACE FUNCTION — left as-is.

-- ---------------------------------------------------------------------------
-- 4. set_courier_online_status — recreated from its CURRENT live body
--    (20260727001400_ghost_auto_offline's version, with the streak reset).
--    Deliberate widening vs. a literal "swap cap_mdl for the fn": this
--    function never read cap_mdl directly (only reactivation_threshold_mdl),
--    so there was nothing to substitute 1-for-1. Instead the gate now blocks
--    at LEAST(reactivation_threshold, effective_cap) — for the seeded policy
--    (reactivation 1000 <= cap 1500) this is a no-op for mature couriers
--    (still 1000, unchanged) and for <30d couriers too (effective_cap 1000 =
--    reactivation 1000 today), but it stays correct if a future cash_policy
--    version ever set reactivation_threshold_mdl above a tiered cap — a
--    courier must never be allowed back online already sitting at/above
--    their OWN effective cap, even if that's below the flat reactivation
--    threshold.
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
  v_cap numeric;
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
    v_policy := public.current_cash_policy();
    v_cap := public.effective_cash_cap(v_courier.id);
    if v_policy.reactivation_threshold_mdl is not null and v_cap is not null
       and public.courier_cash_balance(v_courier.id) >= least(v_policy.reactivation_threshold_mdl, v_cap) then
      raise exception 'Plafon numerar atins — predă încasările înainte să revii online.';
    end if;
    insert into public.courier_shifts (courier_id, started_at) values (v_courier.id, now());
  else
    update public.courier_shifts set ended_at = now()
    where courier_id = v_courier.id and ended_at is null;
  end if;

  -- Ghost auto-offline streak (20260727001400): a manual online reset is a
  -- fresh start, same as an accept.
  update public.couriers
  set status = p_status,
      consecutive_ignored_offers = case when p_status = 'online' then 0 else consecutive_ignored_offers end
  where id = v_courier.id;

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

-- ---------------------------------------------------------------------------
-- 5. reconcile_cash_ledger — hourly cross-check, signal-only (never blocks,
--    never mutates the ledger). Ledger balance (courier_cash_balance, the
--    sum-of-movements view already used everywhere) vs an INDEPENDENT
--    recompute straight from orders (delivered + cash + paid) plus the
--    ledger's own offload rows (offloads have no order-side counterpart to
--    recompute from — they're admin hand-offs, not deliveries). Drift beyond
--    50 MDL means the two sources disagree, which should be structurally
--    impossible given the accrual hook — so it's worth a human look:
--    inserts one fraud_flags row (signal-only, same table/shape as the WS10
--    GPS-plausibility flags) + notifies every platform_admin via the
--    existing notification_outbox.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_cash_ledger()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_drift numeric;
  v_admin uuid;
begin
  for v_rec in
    select
      c.id as courier_id,
      public.courier_cash_balance(c.id) as ledger_balance,
      coalesce((
        select sum(o.total_mdl) from public.orders o
        where o.courier_id = c.id and o.status = 'delivered'
          and o.payment_method = 'cash' and o.payment_status = 'paid'
      ), 0)
      + coalesce((
        select sum(m.amount_mdl) from public.courier_cash_movements m
        where m.courier_id = c.id and m.kind = 'offload'
      ), 0) as recomputed_balance
    from public.couriers c
  loop
    v_drift := v_rec.ledger_balance - v_rec.recomputed_balance;
    if abs(v_drift) > 50 then
      insert into public.fraud_flags (courier_id, kind, detail)
      values (
        v_rec.courier_id, 'cash_ledger_drift',
        jsonb_build_object(
          'ledger_balance', v_rec.ledger_balance,
          'recomputed_balance', v_rec.recomputed_balance,
          'drift_mdl', v_drift
        )
      );

      for v_admin in select id from public.profiles where role = 'platform_admin'
      loop
        insert into public.notification_outbox (user_id, title, body, url, tag)
        values (
          v_admin,
          'Discrepanță numerar curier',
          format('Curier %s: sold jurnal %s MDL vs. recalculat din comenzi %s MDL (diferență %s MDL).',
                 v_rec.courier_id, v_rec.ledger_balance, v_rec.recomputed_balance, v_drift),
          '/platform/fraud',
          'cash'
        );
      end loop;
    end if;
  end loop;
end;
$$;
revoke execute on function public.reconcile_cash_ledger() from public, anon, authenticated;
alter function public.reconcile_cash_ledger() set statement_timeout = '30s';

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-cash-ledger') then
    perform cron.unschedule('reconcile-cash-ledger');
  end if;
end
$do$;
select cron.schedule('reconcile-cash-ledger', '0 * * * *', $$select public.reconcile_cash_ledger();$$);
