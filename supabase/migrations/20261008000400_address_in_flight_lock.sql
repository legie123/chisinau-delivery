-- Address integrity. orders.delivery_address_id points at the LIVE addresses row: the
-- courier navigates to it, courier_is_assigned_to_address exposes it, and
-- advance_delivery_status recomputes the courier fee from its lat/lng at handover.
-- addresses_owner_update let the owner rewrite street/pin while an order to it was in
-- flight — the courier redirected mid-delivery, the fee repriced at delivery.
-- Fix: BEFORE UPDATE trigger freezes the LOCATION columns while any order to the
-- address is not delivered/cancelled/rejected. Contact columns (contact_phone,
-- intercom_code, notes, label, is_default) stay editable: a wrong phone or gate code
-- mid-delivery is exactly what the customer must be able to correct, and the web
-- checkout writes contact_phone on a saved address. Delete is already blocked by the
-- orders FK (NO ACTION).
-- Why no snapshot on orders: it would need new PII columns (+ purge_expired_pii), and
-- every reader (courier web/app, fee recompute, admin, customer) moved to them. The
-- trigger closes the in-flight hole; for history, both apps already save an edit of a
-- used address as a NEW row (mobile addressEditPlan; the web has no address editor),
-- so a finished order keeps pointing at what it was delivered to.

create or replace function public.guard_address_in_flight()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.orders
    where delivery_address_id = old.id
      and status not in ('delivered', 'cancelled', 'rejected')
  ) then
    raise exception 'adresa este folosită de o comandă în curs și nu poate fi modificată — salveaz-o ca adresă nouă';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_address_in_flight() from public, anon, authenticated;

drop trigger if exists addresses_guard_in_flight on public.addresses;
create trigger addresses_guard_in_flight
  before update on public.addresses
  for each row
  when ((old.street_address, old.sector, old.building, old.apartment, old.entrance, old.floor, old.lat, old.lng)
        is distinct from
        (new.street_address, new.sector, new.building, new.apartment, new.entrance, new.floor, new.lat, new.lng))
  execute function public.guard_address_in_flight();
