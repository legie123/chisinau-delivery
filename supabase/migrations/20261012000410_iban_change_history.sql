-- Every IBAN change leaves a trace (red-team finding on 9c2e8db). Any restaurant_staff member (the
-- table has no role column) or a compromised courier account could redirect payouts: set_payout_account
-- upserts, the old IBAN was overwritten, and zz_admin_audit logs admin interventions only.
-- payout_account_changes records EVERY insert/update of payout_accounts by anyone: payee, last 4 of the
-- old and new IBAN (masked on purpose — no second full-IBAN copy, so no new PII surface to purge), who
-- (auth.uid(), null for system), when. Admin-only read; written only by the trigger. The payouts page
-- flags payees whose IBAN changed in the last 7 days before money is sent.
-- Restricting WHICH staff may change the IBAN needs a staff role (RESTAURANT schema) — handoff, not here.
-- Rollback: drop trigger payout_accounts_history on public.payout_accounts;
--   drop function public.record_payout_account_change(); drop table public.payout_account_changes;

create table if not exists public.payout_account_changes (
  id             bigint generated always as identity primary key,
  recipient_type text        not null,
  recipient_id   uuid        not null,
  old_iban_last4 text,
  new_iban_last4 text        not null,
  changed_by     uuid,
  changed_at     timestamptz not null default now()
);
create index if not exists payout_account_changes_payee on public.payout_account_changes (recipient_type, recipient_id, changed_at desc);
alter table public.payout_account_changes enable row level security;

drop policy if exists payout_account_changes_admin_read on public.payout_account_changes;
create policy payout_account_changes_admin_read on public.payout_account_changes
  for select to authenticated, viewer using ((select public.has_role('platform_admin')));
drop policy if exists viewer_session_live on public.payout_account_changes;
create policy viewer_session_live on public.payout_account_changes
  as restrictive for select to viewer using ((select public.viewer_session_live()));
revoke all on public.payout_account_changes from anon, authenticated;
grant select on public.payout_account_changes to authenticated, viewer;

create or replace function public.record_payout_account_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and old.iban = new.iban then return null; end if;
  insert into public.payout_account_changes (recipient_type, recipient_id, old_iban_last4, new_iban_last4, changed_by)
  values (new.recipient_type, new.recipient_id,
          case when tg_op = 'UPDATE' then right(old.iban, 4) end, right(new.iban, 4), auth.uid());
  return null;
end; $function$;

revoke all on function public.record_payout_account_change() from public, anon, authenticated;

drop trigger if exists payout_accounts_history on public.payout_accounts;
create trigger payout_accounts_history
  after insert or update on public.payout_accounts
  for each row execute function public.record_payout_account_change();
