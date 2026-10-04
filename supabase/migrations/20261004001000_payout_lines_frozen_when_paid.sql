-- The paid ledger was frozen only against UPDATE (guard_payout_order_immutable is BEFORE UPDATE): a
-- line of a PAID payout could still be deleted or added, and an admin DELETE of a settled order
-- cascaded its lines away (payout_orders.order_id ON DELETE CASCADE), leaving the paid header's
-- orders_count / gross / net describing lines that no longer exist (cross-app E2E audit, 2026-10-04).
-- Membership is frozen too: once the parent payout is paid no line is inserted or deleted, whoever
-- asks (trigger, so definer and service_role included). A cascading delete of a settled order now
-- fails as a whole. Pending payouts are unaffected (admin_generate_payouts builds them line by line).
create or replace function public.guard_payout_order_membership()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_payout uuid := case when tg_op = 'DELETE' then old.payout_id else new.payout_id end;
begin
  if exists (select 1 from public.payouts p where p.id = v_payout and p.status = 'paid') then
    raise exception 'ledger-ul de payout este imutabil — liniile unei plăți achitate nu se adaugă și nu se șterg';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke execute on function public.guard_payout_order_membership() from public;

create trigger guard_payout_order_membership
  before insert or delete on public.payout_orders
  for each row execute function public.guard_payout_order_membership();
