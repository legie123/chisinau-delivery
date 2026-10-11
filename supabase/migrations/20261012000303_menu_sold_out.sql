-- Quick "Epuizat" on the kitchen tablet, separate from is_available. is_available=false
-- means "hidden" (menu_items_public_read filters it out), so marking a dish sold out
-- used to make it vanish from the menu. sold_out_until keeps the item visible and
-- refusable: sold out while sold_out_until > now(). 'today' lapses at the next
-- Chișinău midnight on its own; 'indefinite' = 'infinity' until switched back.
-- The place_order guard and the customer rendering belong to CLIENT (CROSS-REQUESTS).

alter table public.menu_items add column sold_out_until timestamptz;

create or replace function public.set_menu_item_sold_out(p_item_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_restaurant uuid;
begin
  select restaurant_id into v_restaurant from public.menu_items where id = p_item_id;
  if v_restaurant is null or not has_restaurant_access(v_restaurant) then raise exception 'not authorized'; end if;
  if p_mode not in ('today', 'indefinite', 'off') then
    raise exception 'Mod invalid: alege „azi”, „până revin” sau „disponibil”.';
  end if;
  update public.menu_items
  set sold_out_until = case p_mode
        when 'today' then (date_trunc('day', now() at time zone 'Europe/Chisinau') + interval '1 day') at time zone 'Europe/Chisinau'
        when 'indefinite' then 'infinity'::timestamptz
        else null end
  where id = p_item_id;
end;
$function$;

revoke all on function public.set_menu_item_sold_out(uuid, text) from public, anon;
grant execute on function public.set_menu_item_sold_out(uuid, text) to authenticated, service_role;
