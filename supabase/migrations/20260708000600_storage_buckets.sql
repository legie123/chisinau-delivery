-- Menu/restaurant photo storage. Public read (menu photos must be visible to
-- unauthenticated browsers), write gated by has_restaurant_access on the
-- restaurant id encoded as the first path segment: {restaurantId}/{...}.

insert into storage.buckets (id, name, public)
values ('restaurant-photos', 'restaurant-photos', true)
on conflict (id) do nothing;

create policy "restaurant_photos_public_read" on storage.objects
  for select using (bucket_id = 'restaurant-photos');

create policy "restaurant_photos_staff_write" on storage.objects
  for insert with check (
    bucket_id = 'restaurant-photos'
    and public.has_restaurant_access(((storage.foldername(name))[1])::uuid)
  );

create policy "restaurant_photos_staff_update" on storage.objects
  for update using (
    bucket_id = 'restaurant-photos'
    and public.has_restaurant_access(((storage.foldername(name))[1])::uuid)
  );

create policy "restaurant_photos_staff_delete" on storage.objects
  for delete using (
    bucket_id = 'restaurant-photos'
    and public.has_restaurant_access(((storage.foldername(name))[1])::uuid)
  );
