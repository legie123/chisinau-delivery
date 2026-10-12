-- Settlement bound to the EXPORTED file (red-team round 2, HIGH, on 50c9a03). The CSV was computed at
-- download and the page button at render; admin_settle_payee took the page's number, so a refund
-- between export and click settled the clawback too: bank got 240, ledger said 160 -> 80 MDL over.
--
-- admin_create_payout_export(): freezes a batch. Per payee with a positive net and an IBAN on file:
-- the exact pending payout ids, the net, the IBAN + holder AT EXPORT TIME, and iban_changed = the IBAN
-- was changed (an old value existed) after the payee's last paid payout. Rows already in an OPEN line
-- of another batch are not exported again. The CSV is rendered from this batch.
-- admin_settle_export_line(batch, type, id, iban_confirmed): marks exactly those payout ids paid, only
-- if all are still pending; an iban_changed line needs iban_confirmed = true. A clawback created after
-- the export is not in the batch: it stays pending and is netted into the next export.
-- admin_void_payout_export(batch): releases the open lines of a batch that was not sent.
-- admin_settle_payee (page-bound) is dropped.
-- Rollback: drop the three functions and the two tables; re-apply 20261012000409.

drop function if exists public.admin_settle_payee(text, uuid, numeric);

create table if not exists public.payout_exports (
  id         uuid        primary key default gen_random_uuid(),
  created_by uuid        default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at  timestamptz
);

create table if not exists public.payout_export_lines (
  export_id      uuid          not null references public.payout_exports(id) on delete restrict,
  recipient_type text          not null check (recipient_type in ('courier', 'restaurant')),
  recipient_id   uuid          not null,
  name           text          not null,
  iban           text          not null,
  holder_name    text          not null,
  net_mdl        numeric(10,2) not null check (net_mdl > 0),
  payout_ids     uuid[]        not null,
  iban_changed   boolean       not null default false,
  settled_at     timestamptz,
  settled_by     uuid,
  primary key (export_id, recipient_type, recipient_id)
);

alter table public.payout_exports enable row level security;
alter table public.payout_export_lines enable row level security;
drop policy if exists payout_exports_admin_read on public.payout_exports;
create policy payout_exports_admin_read on public.payout_exports
  for select to authenticated, viewer using ((select public.has_role('platform_admin')));
drop policy if exists payout_export_lines_admin_read on public.payout_export_lines;
create policy payout_export_lines_admin_read on public.payout_export_lines
  for select to authenticated, viewer using ((select public.has_role('platform_admin')));
drop policy if exists viewer_session_live on public.payout_exports;
create policy viewer_session_live on public.payout_exports
  as restrictive for select to viewer using ((select public.viewer_session_live()));
drop policy if exists viewer_session_live on public.payout_export_lines;
create policy viewer_session_live on public.payout_export_lines
  as restrictive for select to viewer using ((select public.viewer_session_live()));
revoke all on public.payout_exports, public.payout_export_lines from anon, authenticated;
grant select on public.payout_exports, public.payout_export_lines to authenticated, viewer;

create or replace function public.admin_create_payout_export()
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid; v_n int;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  perform pg_advisory_xact_lock(hashtext('admin_generate_payouts'));
  insert into public.payout_exports default values returning id into v_id;

  insert into public.payout_export_lines (export_id, recipient_type, recipient_id, name, iban, holder_name, net_mdl, payout_ids, iban_changed)
  select v_id, p.recipient_type, p.recipient_id,
         coalesce((select c.full_name from public.couriers c where p.recipient_type = 'courier' and c.id = p.recipient_id),
                  (select r.name from public.restaurants r where p.recipient_type = 'restaurant' and r.id = p.recipient_id), '—'),
         a.iban, a.holder_name, sum(p.net_mdl), array_agg(p.id order by p.period_start, p.id),
         exists (select 1 from public.payout_account_changes ch
                 where ch.recipient_type = p.recipient_type and ch.recipient_id = p.recipient_id
                   and ch.old_iban_last4 is not null
                   and ch.changed_at > coalesce((select max(pp.paid_at) from public.payouts pp
                                                 where pp.recipient_type = p.recipient_type and pp.recipient_id = p.recipient_id
                                                   and pp.status = 'paid'), '-infinity'::timestamptz))
  from public.payouts p
  join public.payout_accounts a on a.recipient_type = p.recipient_type and a.recipient_id = p.recipient_id
  where p.status = 'pending'
    and not exists (select 1 from public.payout_export_lines l join public.payout_exports e on e.id = l.export_id
                    where e.voided_at is null and l.settled_at is null and p.id = any(l.payout_ids))
  group by p.recipient_type, p.recipient_id, a.iban, a.holder_name
  having sum(p.net_mdl) > 0;

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nimic de exportat: niciun beneficiar cu sold pozitiv și IBAN, în afara loturilor deschise.'; end if;
  return v_id;
end; $function$;

create or replace function public.admin_settle_export_line(p_export_id uuid, p_recipient_type text, p_recipient_id uuid,
                                                           p_iban_confirmed boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_line public.payout_export_lines%rowtype; v_voided timestamptz;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  perform pg_advisory_xact_lock(hashtext('admin_generate_payouts'));
  select * into v_line from public.payout_export_lines
   where export_id = p_export_id and recipient_type = p_recipient_type and recipient_id = p_recipient_id for update;
  if not found then raise exception 'Linia nu există în acest export.'; end if;
  select voided_at into v_voided from public.payout_exports where id = p_export_id;
  if v_voided is not null then raise exception 'Exportul a fost anulat — exportă din nou.'; end if;
  if v_line.settled_at is not null then raise exception 'Linia a fost deja marcată plătită.'; end if;
  if v_line.iban_changed and not coalesce(p_iban_confirmed, false) then
    raise exception 'IBAN-ul s-a schimbat de la ultima plată — confirmă cu beneficiarul înainte să marchezi plătit.';
  end if;
  if exists (select 1 from public.payouts where id = any(v_line.payout_ids) and status <> 'pending') then
    raise exception 'O plată din linie nu mai e în așteptare — anulează exportul și exportă din nou.';
  end if;
  update public.payouts set status = 'paid', paid_at = now() where id = any(v_line.payout_ids);
  update public.payout_export_lines set settled_at = now(), settled_by = auth.uid()
   where export_id = p_export_id and recipient_type = p_recipient_type and recipient_id = p_recipient_id;
end; $function$;

create or replace function public.admin_void_payout_export(p_export_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  update public.payout_exports set voided_at = now() where id = p_export_id and voided_at is null;
  if not found then raise exception 'Exportul nu există sau e deja anulat.'; end if;
end; $function$;

revoke all on function public.admin_create_payout_export() from public, anon;
revoke all on function public.admin_settle_export_line(uuid, text, uuid, boolean) from public, anon;
revoke all on function public.admin_void_payout_export(uuid) from public, anon;
grant execute on function public.admin_create_payout_export() to authenticated;
grant execute on function public.admin_settle_export_line(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.admin_void_payout_export(uuid) to authenticated;
