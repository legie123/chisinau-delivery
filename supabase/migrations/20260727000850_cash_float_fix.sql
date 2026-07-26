-- Adversarial-review fix for 20260727000800_cash_float.sql.
--
-- BUG (confirmed live, rolled-back probe): in set_courier_online_status's
-- cash-cap reactivation gate, `v_policy := public.current_cash_policy();`
-- assigns the WHOLE ROW, then guards with `if v_policy is not null and ...`.
-- Postgres composite-row IS NOT NULL is true only when EVERY field is
-- non-null (not the same as "row IS NULL is false") — and cash_policy.
-- created_by is a nullable FK (`references auth.users(id) on delete set
-- null`), NULL on the seeded v1 row and on any future version created
-- without an explicit `note`/whose creator gets scrubbed. So
-- `v_policy is not null` evaluated to FALSE, the `and` short-circuited, and
-- the entire hard-cap gate never fired: a courier sitting at/above the
-- reactivation threshold (or even the cap itself) could always toggle back
-- online. Verified in a rolled-back tx: courier at balance = threshold
-- (1000.00 = 1000.00) called set_courier_online_status('online') and
-- succeeded with status flipping to 'online' — no exception.
--
-- (enforce_cash_cap_offline is NOT affected — it assigns only the scalar
-- `cap_mdl` into a plain numeric, so its own "is not null" check is on a
-- scalar and behaves correctly; verified separately.)
--
-- Fix: guard on a scalar field of v_policy, not the composite row.
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
    -- reactivation threshold, not the cap — see 20260727000800 header
    -- comment for the hysteresis rationale.
    --
    -- FIXED: guard on the scalar `reactivation_threshold_mdl` field, not
    -- `v_policy is not null` on the whole composite row — the row's
    -- `created_by` is nullable and NULL on the seed row, which makes
    -- Postgres's composite IS NOT NULL (true only if EVERY field is
    -- non-null) evaluate to false and silently skip the gate entirely.
    v_policy := public.current_cash_policy();
    if v_policy.reactivation_threshold_mdl is not null
       and public.courier_cash_balance(v_courier.id) >= v_policy.reactivation_threshold_mdl then
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
-- Grants unchanged (CREATE OR REPLACE preserves them), restated for anyone
-- reading migrations top-to-bottom:
revoke execute on function public.set_courier_online_status(text) from public, anon;
grant execute on function public.set_courier_online_status(text) to authenticated;
