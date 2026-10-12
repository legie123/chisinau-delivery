-- Rollback of 20261012000303. Loses current sold-out marks (they are same-day state).
drop function if exists public.set_menu_item_sold_out(uuid, text);
alter table public.menu_items drop column if exists sold_out_until;
