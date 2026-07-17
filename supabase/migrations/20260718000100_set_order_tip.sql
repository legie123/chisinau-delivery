-- Customer sets a tip on their own order (before it's terminal). Direct order
-- writes are RLS-blocked, so this guarded RPC is the path. Tip folds into total_mdl.
create or replace function public.set_order_tip(p_order_id uuid, p_tip_mdl numeric)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_order public.orders%rowtype;
begin
  if p_tip_mdl is null or p_tip_mdl < 0 then raise exception 'invalid tip'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status in ('delivered', 'cancelled', 'rejected') then raise exception 'too late to tip'; end if;
  update public.orders
  set tip_mdl = round(p_tip_mdl, 2),
      total_mdl = v_order.subtotal_mdl + v_order.delivery_fee_mdl + round(p_tip_mdl, 2)
  where id = p_order_id;
end; $$;
grant execute on function public.set_order_tip(uuid, numeric) to authenticated;
