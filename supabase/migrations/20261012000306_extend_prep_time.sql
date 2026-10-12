-- "Mai am nevoie de timp" after accepting: set_prep_time_estimate only works before
-- accept, so a kitchen running late had no way to move the customer's countdown
-- (PrepCountdown reads orders.estimated_ready_at live). extend_prep_time adds 5/10/15 min
-- from max(estimated_ready_at, now()), only while accepted, own restaurant only, and never
-- past now()+60 min (ponytail: fixed cap; make it config if partners need longer).
-- Rollback: supabase/rollbacks/20261012000306_extend_prep_time.down.sql

create or replace function public.extend_prep_time(p_order_id uuid, p_minutes int)
returns timestamptz
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
  v_new timestamptz;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if p_minutes not in (5, 10, 15) then raise exception 'Alege 5, 10 sau 15 minute.'; end if;
  if v_order.status <> 'accepted' then
    raise exception 'Timpul se poate prelungi doar cât comanda e în preparare (stare curentă: %).', v_order.status;
  end if;
  v_new := greatest(coalesce(v_order.estimated_ready_at, now()), now()) + make_interval(mins => p_minutes);
  if v_new > now() + interval '60 minutes' then
    raise exception 'Comanda nu poate fi gata mai târziu de o oră de acum — sună suportul dacă e nevoie.';
  end if;
  update public.orders set estimated_ready_at = v_new where id = p_order_id;
  return v_new;
end;
$function$;

revoke all on function public.extend_prep_time(uuid, int) from public, anon;
grant execute on function public.extend_prep_time(uuid, int) to authenticated, service_role;
