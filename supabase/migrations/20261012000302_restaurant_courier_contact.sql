-- The courier card on the kitchen tablet: first name + phone of the courier coming
-- for THIS restaurant's order, only while courier_assigned / picked_up / en_route
-- (owner decision 2026-10-11: restaurants may see the phone in that window).
-- Partners have no read on `couriers` under RLS, so before this the pickup card's
-- courier name was always null. Same shape as order_courier_contact (customer side).
create or replace function public.restaurant_courier_contact(p_order_id uuid)
returns table(first_name text, phone text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select split_part(btrim(c.full_name), ' ', 1), c.phone
  from public.orders o
  join public.couriers c on c.id = o.courier_id
  where o.id = p_order_id
    and public.has_restaurant_access(o.restaurant_id)
    and o.status in ('courier_assigned', 'picked_up', 'en_route');
$function$;

revoke all on function public.restaurant_courier_contact(uuid) from public, anon;
grant execute on function public.restaurant_courier_contact(uuid) to authenticated, service_role;
