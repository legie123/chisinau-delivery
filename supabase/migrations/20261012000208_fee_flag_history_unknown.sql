-- The fee-flag backfill stops asserting anything about history (verif-curier round 3, 2026-10-12).
--
-- 20261012000204/000207 set courier_fee_distance_assumed = true on historic deliveries whose pin is missing
-- TODAY. That is not "missing at delivery": a customer can clear their own address pin through the API after
-- delivery, an admin can clear a restaurant pin, and the erase marker 'Adresă ștearsă' is customer-writable
-- text (so it can also hide a real assumption). The pin state at delivery is not recorded anywhere, so for
-- deliveries made before the flag existed nothing can be proven: they are all NULL ("not evaluated").
-- Only advance_delivery_status (000202, 000206) writes true/false, at delivery, from the pins it actually used.
--
-- backfill_courier_fee_distance_assumed(cutoff) now only sets delivered rows before the cutoff to null, and the
-- trues the earlier backfill wrote are repaired below. No amount changes (courier_fee_mdl is not touched).
-- Known loss, local only: deliveries evaluated by advance_delivery_status between 000202 and the cutoff
-- (2026-10-11 21:17Z, E2E data) become null as well — unknown, never a false claim.
-- The column comment is brought up to 000206 (pinless = base fee, the quote is a floor only when measured).
-- ROLLBACK: supabase/rollbacks/20261012000208_fee_flag_history_unknown.down.sql
create or replace function public.backfill_courier_fee_distance_assumed(p_delivered_before timestamptz)
returns integer
language plpgsql
set search_path = 'public'
as $$
declare
  v_changed integer;
begin
  update public.orders o
     set courier_fee_distance_assumed = null
   where o.status = 'delivered'
     and o.delivered_at < p_delivered_before
     and o.courier_fee_distance_assumed is not null;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.backfill_courier_fee_distance_assumed(timestamptz) from public, anon, authenticated, service_role;

select public.backfill_courier_fee_distance_assumed('2026-10-12T00:00:00Z');

comment on column public.orders.courier_fee_distance_assumed is
  'Delivered orders only, written by advance_delivery_status at delivery. true = a pin was missing, so only the base fee (+ stamped weather surcharge) was paid and the ready quote was not a floor (20261012000206); km are added on admin review. false = the distance was measured. null = not evaluated: delivered before 2026-10-12 (pin state at delivery unknown) or not delivered.';
