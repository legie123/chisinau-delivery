-- Cross-restaurant dish search (Bolt-Food-style: query matches items across
-- the whole catalog, not just restaurant name/description).
-- security_invoker: relies on the existing menu_items_public_read RLS policy
-- (available item + active restaurant, OR staff access) — no privilege change.
create or replace function public.search_menu_items(p_query text)
returns table (
  item_id uuid,
  item_name text,
  item_description text,
  price_mdl numeric,
  photo_url text,
  restaurant_id uuid,
  restaurant_slug text,
  restaurant_name text,
  cuisine_type text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    mi.id,
    mi.name,
    mi.description,
    mi.price_mdl,
    mi.photo_url,
    r.id,
    r.slug,
    r.name,
    r.cuisine_type
  from public.menu_items mi
  join public.restaurants r on r.id = mi.restaurant_id
  where
    length(trim(p_query)) >= 2
    and mi.is_available = true
    and mi.is_catering_only = false
    and r.is_active = true
    and (mi.name ilike '%' || p_query || '%' or mi.description ilike '%' || p_query || '%')
  order by
    (mi.name ilike p_query || '%') desc,   -- prefix match on name first
    (mi.name ilike '%' || p_query || '%') desc, -- then any name match
    mi.name asc
  limit 30;
$$;

grant execute on function public.search_menu_items(text) to anon, authenticated;
