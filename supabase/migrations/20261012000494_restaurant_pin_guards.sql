-- Pin rule A, the ADMIN half (owner decision 2026-10-12/13; ADMIN-MATRICE-CONTROL §B1 option 1,
-- CROSS-REQUESTS RESTAURANT→ADMIN). One BEFORE UPDATE trigger on restaurants, two guards:
-- 1) The pin cannot move while the restaurant has orders in flight (ready_for_pickup … en_route).
--    advance_delivery_status pays greatest(quote stamped at mark_ready_for_pickup, recompute from the
--    CURRENT pin): a pin moved 5 km farther between "ready" and "delivered" paid +71 % for a distance
--    nobody drove (B1 proof). Same rule as addresses_guard_in_flight; no money function touched.
-- 2) Activation (is_active false→true) needs a pin AND the partner's confirmation (pin_confirmed_at,
--    set only by confirm_restaurant_pin, 000308). No service-zone function exists (confirm_restaurant_pin
--    checks lat/lng not null only), so the rule here is the same: pin present + confirmed.
-- The trigger bites every writer alike: the admin panel (direct update as authenticated), postgres and
-- any security-definer RPC. review_onboarding_application inserts is_active=false, so the only
-- activation path is this UPDATE. Fires after restaurants_guard_platform_cols (alphabetical), so a
-- partner's reverted lat/lng never counts as a move.
-- Rollback: drop trigger restaurants_pin_guards on public.restaurants;
--           drop function public.guard_restaurant_pin();

create or replace function public.guard_restaurant_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved boolean := new.lat is distinct from old.lat or new.lng is distinct from old.lng;
begin
  if v_moved and exists (
    select 1 from public.orders
     where restaurant_id = old.id
       and status in ('ready_for_pickup', 'courier_assigned', 'picked_up', 'en_route')
  ) then
    raise exception 'Restaurantul are comenzi în curs; pinul se poate muta după livrare.';
  end if;

  -- A move in the same statement drops the confirmation (restaurants_pin_unconfirm_on_move runs after
  -- this trigger), so it counts as unconfirmed here.
  if new.is_active is true and old.is_active is not true
     and (new.lat is null or new.lng is null or new.pin_confirmed_at is null or v_moved) then
    raise exception 'Restaurantul nu poate fi activat fără un pin pe hartă confirmat de partener.';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_restaurant_pin() from public, anon, authenticated;

drop trigger if exists restaurants_pin_guards on public.restaurants;
create trigger restaurants_pin_guards
  before update of lat, lng, is_active on public.restaurants
  for each row execute function public.guard_restaurant_pin();
