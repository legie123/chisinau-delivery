-- Master-audit §6.3 — payout ledger immutability discipline.
--
-- What already exists (the audit's "fără clawback" snapshot is stale): per-delivery
-- idempotency via payout_orders PK (order_id, recipient_type); the
-- orders_clawback_on_refund trigger (refund → NEW negative payout + payout_orders
-- .reversed_at marker, never an edit); advisory-locked generation gated on
-- delivered+paid; assign (courier lifecycle) is separate from mark-paid (admin RPC).
--
-- What was missing: the invariant "A ledger transaction is mutable while pending and
-- immutable once posted" (Modern Treasury). Nothing stopped a paid payout from being
-- edited/deleted at the DB. These two triggers enforce it absolutely (for every
-- caller, definer included), so a correction MUST be a new transaction — exactly how
-- the clawback already works.

-- 1. A PAID payout is immutable: no UPDATE, no DELETE. (pending → paid still works,
--    since that UPDATE has OLD.status='pending'.)
create or replace function public.guard_paid_payout_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'paid' then
      raise exception 'un payout plătit este imutabil — corecțiile se fac cu o tranzacție nouă (storno)';
    end if;
    return old;
  end if;
  if old.status = 'paid' then
    raise exception 'un payout plătit este imutabil — corecțiile se fac cu o tranzacție nouă (storno)';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_paid_payout_immutable on public.payouts;
create trigger guard_paid_payout_immutable
  before update or delete on public.payouts
  for each row execute function public.guard_paid_payout_immutable();

-- 2. The settled ledger row (payout_orders) is immutable except for the reversed_at
--    correction marker the clawback sets. Financial + link fields never change.
create or replace function public.guard_payout_order_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_id is distinct from old.order_id
     or new.recipient_type is distinct from old.recipient_type
     or new.payout_id is distinct from old.payout_id
     or new.gross_mdl is distinct from old.gross_mdl
     or new.net_mdl is distinct from old.net_mdl then
    raise exception 'ledger-ul de payout este imutabil — doar reversed_at poate fi setat post-decontare';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_payout_order_immutable on public.payout_orders;
create trigger guard_payout_order_immutable
  before update on public.payout_orders
  for each row execute function public.guard_payout_order_immutable();
