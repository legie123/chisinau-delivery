-- previous body (live before 000311)
drop function if exists public.confirm_catering_quote(uuid, numeric);
CREATE OR REPLACE FUNCTION public.confirm_catering_quote(p_order_id uuid)
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

  update public.catering_details set quote_status = 'confirmed' where order_id = p_order_id;
  update public.orders
    set status = 'accepted',
        total_mdl = v_details.quoted_total_mdl + coalesce(v_order.tip_mdl, 0)  -- tip on top, not overwritten
    where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', 'customer', auth.uid());
end;
$function$;

revoke execute on function public.confirm_catering_quote(uuid) from public, anon;
grant execute on function public.confirm_catering_quote(uuid) to authenticated, service_role;
