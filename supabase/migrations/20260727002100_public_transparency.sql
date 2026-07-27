-- Order 9 (unblocked by order 6's dispatch anonymity, 20260727001300) —
-- PUBLIC TRANSPARENCY PAGE. Two pieces:
--
-- 1) FEE-FLOOR TRIGGER — orders.delivery_fee_mdl is stamped once, at checkout
--    (place_order variants insert it from the restaurant's current rate card),
--    and the pilot promise is "the fee you see is a floor, never cut after the
--    fact". Audited every UPDATE across the schema before writing this guard
--    (grep -rn "delivery_fee_mdl" supabase/migrations/*.sql, all 20+ hits):
--    NOT ONE migration ever UPDATEs public.orders.delivery_fee_mdl after
--    insert — admin_generate_payouts / admin_update_payment_status /
--    admin_reassign_courier / the refund+clawback path (money_integrity_2) /
--    set_order_tip / catering requote+confirm all only READ it. The sibling
--    column courier_fee_mdl/courier_fee_quoted_mdl (added 20260727000900,
--    the COURIER's per-delivery tariff) is the one legitimately written after
--    insert — it is a different column and this guard does not touch it.
--    Conclusion: there is no legitimate app-level path to carve an exception
--    for, so the guard blocks ANY change to delivery_fee_mdl once a row
--    exists, not only decreases — a stricter, simpler, and provably-safe
--    invariant than "block decreases only".
--
-- 2) public_pricing_history() / public_courier_tariff_history() — SECURITY
--    DEFINER readers over pricing_config / courier_tariff_config that EXCLUDE
--    created_by, granted to anon so the versioned/immutable tariff history
--    (set_pricing_config / set_courier_tariff, 20260727000400 / 000900) is
--    checkable by anyone without an account — the audit wedge behind
--    invariant #4 on /cum-functioneaza: "tarife versionate + publicate".
--    created_by is excluded because an admin's identity is an internal detail,
--    not part of the public commitment (and it's the only PII-adjacent column
--    on either table). Both underlying tables restrict SELECT to `authenticated`
--    via RLS (pricing_config_read / courier_tariff_config_read) — these two
--    functions are SECURITY DEFINER specifically to read past that boundary
--    for the anon-visible subset of columns, mirroring get_prep_estimates'
--    security-definer-for-anon-reach pattern (20260717001400).

-- ---------------------------------------------------------------------------
-- 1) Fee-floor: orders.delivery_fee_mdl is write-once after insert.
-- ---------------------------------------------------------------------------
create or replace function public.guard_delivery_fee_floor()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.delivery_fee_mdl is distinct from old.delivery_fee_mdl then
    raise exception
      'delivery_fee_mdl este stabilit o singură dată, la finalizarea comenzii, și nu mai poate fi modificat (comanda %, % -> %)',
      old.order_number, old.delivery_fee_mdl, new.delivery_fee_mdl;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_delivery_fee_floor on public.orders;
create trigger guard_delivery_fee_floor
  before update on public.orders
  for each row execute function public.guard_delivery_fee_floor();

-- ---------------------------------------------------------------------------
-- 2) Published, versioned tariff histories — anon-readable, created_by excluded.
-- ---------------------------------------------------------------------------
create or replace function public.public_pricing_history()
returns table (
  id uuid,
  effective_from timestamptz,
  courier_pct numeric,
  restaurant_pct numeric,
  note text
)
language sql stable security definer set search_path = public
as $$
  select pc.id, pc.effective_from, pc.courier_commission_pct, pc.restaurant_commission_pct, pc.note
  from public.pricing_config pc
  order by pc.effective_from asc;
$$;
revoke all on function public.public_pricing_history() from public;
grant execute on function public.public_pricing_history() to anon, authenticated;

create or replace function public.public_courier_tariff_history()
returns table (
  id uuid,
  effective_from timestamptz,
  base_mdl numeric,
  per_km_mdl numeric,
  wait_per_min_mdl numeric,
  wait_grace_minutes int,
  note text
)
language sql stable security definer set search_path = public
as $$
  select ctc.id, ctc.effective_from, ctc.base_mdl, ctc.per_km_mdl, ctc.wait_per_min_mdl, ctc.wait_grace_minutes, ctc.note
  from public.courier_tariff_config ctc
  order by ctc.effective_from asc;
$$;
revoke all on function public.public_courier_tariff_history() from public;
grant execute on function public.public_courier_tariff_history() to anon, authenticated;
