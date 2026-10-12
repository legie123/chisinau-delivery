-- Pay a payee its NET pending balance, once (red-team finding on fac9997). A refund after the weekly
-- run adds a NEGATIVE pending payout (clawback_settled_order_on_refund); the bank CSV skipped
-- negatives and sent the positive payout whole (+105.50 MDL in the probe), and the clawback stayed
-- pending for ever. admin_settle_payee marks ALL pending payouts of one payee paid in one
-- transaction, only when their sum equals the amount that was exported (p_expected_net) and is > 0:
-- a row added between export and click refuses instead of being marked paid unpaid.
-- New function; admin_mark_payout_paid is unchanged (still used for single rows with no clawback).
-- Rollback: drop function public.admin_settle_payee(text, uuid, numeric).

create or replace function public.admin_settle_payee(p_recipient_type text, p_recipient_id uuid, p_expected_net numeric)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_net numeric; v_n int;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  perform pg_advisory_xact_lock(hashtext('admin_generate_payouts'));  -- same lock as the payout run
  select coalesce(sum(net_mdl), 0), count(*) into v_net, v_n
  from public.payouts
  where recipient_type = p_recipient_type and recipient_id = p_recipient_id and status = 'pending';
  if v_n = 0 then raise exception 'Nimic de plătit pentru acest beneficiar.'; end if;
  if v_net <= 0 then raise exception 'Soldul net e % MDL — nu se plătește, se recuperează din plățile următoare.', v_net; end if;
  if abs(v_net - coalesce(p_expected_net, -1)) > 0.005 then
    raise exception 'Soldul s-a schimbat de la export: acum % MDL. Exportă din nou.', v_net;
  end if;
  update public.payouts set status = 'paid', paid_at = now()
  where recipient_type = p_recipient_type and recipient_id = p_recipient_id and status = 'pending';
  return v_n;
end; $function$;

revoke all on function public.admin_settle_payee(text, uuid, numeric) from public, anon;
grant execute on function public.admin_settle_payee(text, uuid, numeric) to authenticated;
