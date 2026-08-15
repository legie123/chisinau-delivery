-- Armata SPOF 2026-08-15 (CRIT): pe comenzile STANDARD curierul nu are cum să
-- sune clientul. Poarta încuiată, interfonul mut, bloc greșit — rămâne doar
-- textul adresei. Telefonul nu era colectat NICĂIERI în fluxul standard:
-- `addresses` n-avea coloană, `place_order` n-avea parametru, iar în DB toți
-- cei 14 clienți aveau `profiles.phone` NULL. (Catering-ul avea contact_phone
-- de la început — de-aia lipsa n-a sărit în ochi.)
--
-- Telefonul stă pe ADRESĂ, nu pe comandă: e o proprietate a locului unde se
-- livrează, se completează o dată și rămâne, iar `addresses` are deja politica
-- prin care curierul asignat citește rândul — deci nu inventăm o nouă cale de
-- acces la date personale, folosim exact granița existentă.
alter table public.addresses
  add column if not exists contact_phone text;

alter table public.addresses
  drop constraint if exists addresses_contact_phone_check,
  add constraint addresses_contact_phone_check
    check (contact_phone is null or length(btrim(contact_phone)) between 6 and 30);

comment on column public.addresses.contact_phone is
  'Telefonul de contact pentru livrare la această adresă. Vizibil curierului DOAR cât timp are comanda în lucru (vezi courier_is_assigned_to_address).';

-- Restrângere de expunere, în aceeași mișcare: politica exista din iulie, dar
-- fereastra era pe viață — un curier care a livrat o dată la o adresă îi citea
-- rândul oricând, la nesfârșit. Acum accesul ține cât e comanda în lucru, plus
-- 24h după livrare (curierul își mai poate deschide livrarea de azi). Istoricul
-- curierului nu citește `addresses`, deci nimic nu se rupe.
create or replace function public.courier_is_assigned_to_address(target_address uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
  select exists (
    select 1 from public.orders
    where delivery_address_id = target_address
      and courier_id = public.current_courier_id()
      and (
        status in ('courier_assigned', 'picked_up', 'en_route')
        or (status = 'delivered' and delivered_at > now() - interval '24 hours')
      )
  );
$function$;
