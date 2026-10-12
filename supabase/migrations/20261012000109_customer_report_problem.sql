-- The customer reports a problem from the app after the restaurant accepted (parity row 12). Until now
-- the app offered nothing once an order was accepted; order_complaints (20261012000404) could be opened
-- only by ops. customer_report_problem(order, kind, note): the order's own customer, any status after
-- pending_restaurant (a pending order is cancelled instead), at most one OPEN complaint per order (the
-- existing partial unique index). It lands in ops' complaint log (created_by = the customer) and raises
-- an ops alert at once (ops_alerts kind 'customer_complaint'; the webhook sends it on the next scan).
-- The customer may read their own orders' complaints (status + resolution) — new select policy.
-- Rollback: drop function public.customer_report_problem(uuid, text, text);
--   drop policy order_complaints_customer_read on public.order_complaints;
--   restore ops_alerts_kind_check without 'customer_complaint'.

alter table public.ops_alerts drop constraint if exists ops_alerts_kind_check;
alter table public.ops_alerts add constraint ops_alerts_kind_check
  check (kind in ('restaurant_not_accepting', 'dispatch_error', 'push_stuck', 'customer_complaint'));

drop policy if exists order_complaints_customer_read on public.order_complaints;
create policy order_complaints_customer_read on public.order_complaints
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()))
  );

create or replace function public.customer_report_problem(p_order_id uuid, p_kind text, p_note text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_order public.orders%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.customer_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status = 'pending_restaurant' then
    raise exception 'Comanda nu e încă acceptată — o poți anula direct din ecranul comenzii.';
  end if;
  if exists (select 1 from public.order_complaints where order_id = p_order_id and status = 'open') then
    raise exception 'Ai deja o problemă raportată pe această comandă — echipa te contactează.';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Descrie pe scurt ce s-a întâmplat.'; end if;

  insert into public.order_complaints (order_id, kind, note, created_by)
  values (p_order_id, p_kind, btrim(p_note), auth.uid())
  returning id into v_id;

  insert into public.ops_alerts (kind, ref_id, message)
  values ('customer_complaint', v_id,
          format('Clientul a raportat o problemă la comanda %s: %s', v_order.order_number, left(btrim(p_note), 200)))
  on conflict (kind, ref_id) do nothing;
  return v_id;
end; $function$;

revoke all on function public.customer_report_problem(uuid, text, text) from public, anon;
grant execute on function public.customer_report_problem(uuid, text, text) to authenticated;
