-- Customer delivery addresses. Deliberately flat/Chisinau-specific: no country/city
-- hierarchy, no geocoding dependency. Courier navigation deep-links to a maps app
-- using lat/lng when the customer has dropped a pin.

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  label text,
  street_address text not null,
  sector text,
  building text,
  apartment text,
  entrance text,
  floor text,
  intercom_code text,
  notes text,
  lat numeric(9, 6),
  lng numeric(9, 6),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.addresses enable row level security;

create index addresses_customer_idx on public.addresses(customer_id);

create policy "addresses_owner_read" on public.addresses
  for select using (customer_id = auth.uid() or has_role('platform_admin'));

create policy "addresses_owner_write" on public.addresses
  for insert with check (customer_id = auth.uid());

create policy "addresses_owner_update" on public.addresses
  for update using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy "addresses_owner_delete" on public.addresses
  for delete using (customer_id = auth.uid());
