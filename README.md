# Chișinău Delivery

Livrare sushi și fine dining în Chișinău + comenzi catering. Next.js 16 App Router + Supabase (Postgres, RLS, Realtime, Auth, Storage).

Trei suprafețe, un singur app, separate prin route groups + RLS pe rol (`customer`, `courier`, `restaurant_partner`, `platform_admin`):

- `(customer)` — `/restaurants` → `/restaurants/[slug]` → `/cart` → `/checkout` → `/orders`/`/orders/[id]`
- `(courier)` — `/deliveries` (Faza 3: acceptare + tracking live)
- `(admin)` — `/restaurant/*` (restaurant_partner: meniu, program, comenzi), `/platform/*` (platform_admin: onboarding restaurante)

Toate schimbările de status pe comandă trec prin RPC-uri Postgres (`place_order`, `accept_order`, `reject_order`, `mark_ready_for_pickup`, `assign_courier`, `advance_delivery_status`, `cancel_order`, `submit_catering_quote`, `decline_catering_quote`, `confirm_catering_quote`) — niciodată `.update()` direct din client pe `orders`/`catering_details`. Fiecare RPC verifică atât tranziția (e validă din starea curentă?) cât și autorizarea (chemătorul chiar are voie?).

## Setup local

1. **Instalează dependențele**

   ```bash
   npm install
   ```

2. **Pornește Supabase local** (necesită Docker Desktop pornit)

   ```bash
   npx supabase start
   ```

   Copiază `anon key`-ul afișat în `.env.local` (vezi `.env.local.example`):

   ```bash
   cp .env.local.example .env.local
   # editează NEXT_PUBLIC_SUPABASE_ANON_KEY cu valoarea din `supabase start`
   ```

3. **Aplică migrațiile + seed data**

   ```bash
   npx supabase db reset
   ```

4. **Creează conturi de test**

   Migrațiile nu seedează `auth.users` (parolele nu pot fi hash-uite direct în SQL în siguranță). Creează conturi prin Studio local (`http://127.0.0.1:54323` → Authentication → Add user), apoi setează rolul:

   ```sql
   -- customer: creat automat cu role='customer' de trigger-ul on_auth_user_created
   -- pentru celelalte roluri, actualizează manual după creare:
   update public.profiles set role = 'platform_admin' where id = '<user-id>';

   update public.profiles set role = 'restaurant_partner' where id = '<user-id>';
   insert into public.restaurant_staff (restaurant_id, user_id)
     values ('11111111-1111-1111-1111-111111111111', '<restaurant-partner-user-id>');

   -- courier: profiles.role + un rând în couriers (RPC-urile assign_courier/
   -- advance_delivery_status caută user-ul curent în tabela couriers, nu în profiles)
   update public.profiles set role = 'courier' where id = '<user-id>';
   insert into public.couriers (user_id, full_name, phone, vehicle_type)
     values ('<user-id>', 'Nume Curier', '+37360000000', 'car');
   ```

5. **Rulează aplicația**

   ```bash
   npm run dev
   ```

   Deschide [http://localhost:3000](http://localhost:3000).

## Regenerare tipuri Supabase

```bash
./scripts/gen-types.sh
```

Suprascrie `src/lib/types/database.types.ts` din schema reală. Până atunci, `src/lib/types/domain.ts` conține tipuri scrise manual, în sincron cu migrațiile.

## Deploy

Vercel (target ales) pentru aplicație; proiect Supabase separat (nou, nu cel de la La Fratii Bikes) pentru producție. Vezi planul din `~/.claude/plans/` pentru fazele următoare.
