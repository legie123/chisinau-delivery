-- confirm_catering_quote(order, p_expected_total): the customer confirms the amount they were SHOWN.
-- CLIENT->RESTAURANT hand-off (gate 2): submit_catering_quote may re-quote while 'quoted', and the old
-- confirm took no amount -> shown 3500, confirmed 9000 (repro docs/handoff/repro/catering-quote-confirm.sql).
-- Delta on the LIVE body: refuse when p_expected_total differs from quoted_total_mdl. Default null keeps old callers working.
-- Old signature dropped explicitly (create or replace would leave both alive -> ambiguous calls).
-- ROLLBACK: supabase/rollbacks/20261012000311_catering_confirm_expected_total.down.sql
drop function if exists public.confirm_catering_quote(uuid);
CREATE OR REPLACE FUNCTION public.confirm_catering_quote(p_order_id uuid, p_expected_total numeric default null)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_order public.orders%rowtype;
  v_details public.catering_details%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status <> 'pending_restaurant' then
    raise exception 'invalid transition from % — comanda nu mai poate fi confirmată', v_order.status;
  end if;

  select * into v_details from public.catering_details where order_id = p_order_id;
  if not found or v_details.quote_status <> 'quoted' then raise exception 'no active quote to confirm'; end if;

  -- the customer confirms the amount they SAW: a re-quote in between is refused, nothing written
  if p_expected_total is not null and p_expected_total is distinct from v_details.quoted_total_mdl then
    raise exception 'oferta s-a schimbat: % MDL — verifică oferta nouă', v_details.quoted_total_mdl;
  end if;

  update public.catering_details set quote_status = 'confirmed' where order_id = p_order_id;
  update public.orders
    set status = 'accepted',
        total_mdl = v_details.quoted_total_mdl + coalesce(v_order.tip_mdl, 0)  -- tip on top, not overwritten
    where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', 'customer', auth.uid());
end;
$function$;

revoke execute on function public.confirm_catering_quote(uuid, numeric) from public, anon;
grant execute on function public.confirm_catering_quote(uuid, numeric) to authenticated, service_role;
