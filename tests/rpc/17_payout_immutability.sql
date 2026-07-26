-- Master-audit §6.3 — a POSTED (paid) payout is immutable; the settled ledger row
-- is immutable except for the reversed_at correction marker. Corrections must be new
-- transactions (which is exactly how orders_clawback_on_refund already works — the
-- existing 02_money_clawback sim proves the clawback still functions under these
-- guards). Rolled back by runner.

do $$
declare
  v_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_pid uuid; v_oid uuid; v_raised boolean; v_rev timestamptz;
begin
  -- a pending payout, then admin marks it paid (pending → paid must still work)
  insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl, status)
  values ('restaurant', v_rest, (now() - interval '7 days')::date, now()::date, 1, 100, 20, 80, 'pending')
  returning id into v_pid;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
  perform public.admin_mark_payout_paid(v_pid);
  if (select status from public.payouts where id = v_pid) <> 'paid' then raise exception 'FAIL: pending→paid transition blocked'; end if;

  -- PAID payout is now immutable: UPDATE must raise
  v_raised := false;
  begin update public.payouts set net_mdl = 999 where id = v_pid; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a paid payout was editable'; end if;

  -- DELETE of a paid payout must raise
  v_raised := false;
  begin delete from public.payouts where id = v_pid; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: a paid payout was deletable'; end if;

  -- settled ledger row: financial edit blocked, reversed_at allowed
  select id into v_oid from public.orders limit 1;
  insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl)
  values (v_pid, v_oid, 'restaurant', 100, 80);

  v_raised := false;
  begin update public.payout_orders set net_mdl = 5 where payout_id = v_pid and order_id = v_oid; exception when others then v_raised := true; end;
  if not v_raised then raise exception 'FAIL: settled ledger financial field was editable'; end if;

  -- the reversal marker (the ONLY allowed post-settlement change) must succeed
  update public.payout_orders set reversed_at = now() where payout_id = v_pid and order_id = v_oid;
  select reversed_at into v_rev from public.payout_orders where payout_id = v_pid and order_id = v_oid;
  if v_rev is null then raise exception 'FAIL: reversed_at could not be set'; end if;

  raise notice 'PASS payout-immutability: pending→paid ok; paid payout un-editable + un-deletable; ledger financials frozen, reversed_at settable';
end $$;
