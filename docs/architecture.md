# Arhitectură — Dragons Delivery (Chișinău)

Actualizat: 2026-07-16. Sursa de adevăr pentru invariante: `CLAUDE.md` (rădăcină).

## Vedere de ansamblu

```
                    ┌──────────────────────────────────────────┐
                    │   Supabase (rdowjxnuyawhrjppxzuu, LIVE)   │
                    │  Postgres + RLS · Auth · Realtime · Storage│
                    └───────▲──────────────▲───────────▲───────┘
                            │              │           │
                 ┌──────────┴───┐   ┌──────┴─────┐  ┌──┴─────────┐
                 │  Web Next.js │   │ mobile/    │  │ mobile/    │
                 │  16 (3 supra-│   │ client     │  │ driver     │
                 │  fețe, PWA)  │   │ (Expo RN)  │  │ (Expo RN)  │
                 └──────────────┘   └────────────┘  └────────────┘
```

- **Un singur backend**, trei clienți. Toți vorbesc direct cu Supabase prin `@supabase/supabase-js` (web: `@supabase/ssr` pentru cookies).
- **RLS este granița de securitate.** Orice gating din UI/proxy e doar UX.
- **Schimbările de status = numai RPC-uri** `security definer` cu dublă verificare (tranziție validă + autorul are dreptul). Niciodată `.update()` din client pe `orders`/`catering_details`.

## Suprafețe web (un app, route groups)

| Group | Rute | Rol |
|---|---|---|
| `(marketing)` | `/` | Hub 3 sectoare; intrare demo fără parolă prin `POST /enter/[role]` (**de șters la lansare**) |
| `(customer)` | `/restaurants`, `/restaurants/[slug]`, `/cart`, `/checkout`, `/orders`, `/orders/[id]`, `/catering`, `/catering/[id]` | client |
| `(courier)` | `/deliveries`, `/deliveries/[id]`, `/deliveries/history` | curier |
| `(admin)` | `/restaurant/{menu,hours,orders,catering}`, `/platform/{restaurants,couriers,orders}` | restaurant_partner / platform_admin |

`src/proxy.ts` (Next 16: fost `middleware.ts`) rulează pe **toate** rutele non-statice — obligatoriu, pentru că doar el persistă token-urile rotite în cookies (Server Components nu pot scrie cookies); în plus face role-gating pe `/deliveries|/restaurant|/platform`.

## Roluri & auth

`profiles.role ∈ {customer, courier, restaurant_partner, platform_admin}`.
- customer: self-signup (trigger `handle_new_customer_signup` creează profilul).
- courier: are OBLIGATORIU și rând în `couriers` (RPC-urile caută în `couriers`, nu în `profiles`).
- restaurant_partner: legat de restaurant prin `restaurant_staff`.
- Guards partajate server-side: `src/lib/auth/require.ts` (requireUser / requireOwnRestaurant / requirePlatformAdmin).
- Funcții RLS: `has_role`, `has_any_role`, `has_restaurant_access`, `current_courier_id` + helpers security-definer anti-recursiune (migrația 001000 — ciclul orders↔couriers).

## Contract RPC (migrația 000500 + următoarele)

| RPC | Cine | Tranziție |
|---|---|---|
| `place_order(restaurant, type, payment, items, addr?, for?, notes?, catering?)` | client autentificat | → `pending_restaurant`; validează server-side: activ+acceptă comenzi, iteme disponibile, minimuri |
| `accept_order` / `reject_order(reason)` | partenerul restaurantului | `pending_restaurant` → `accepted` / `rejected` |
| `mark_ready_for_pickup` | partener | `accepted` → `ready_for_pickup` |
| `assign_courier` | curier activ, max 1 livrare activă | `ready_for_pickup` → `courier_assigned` |
| `advance_delivery_status(new, payment_confirmed?)` | curierul asignat | `courier_assigned→picked_up→en_route→delivered`; la `delivered`+confirm → `payment_status='paid'` |
| `set_courier_online_status` | curierul însuși | online/offline (nu prin update direct) |
| `cancel_order(reason)` | client doar în `pending_restaurant`; admin oricând | → `cancelled` |
| `submit_catering_quote(total)` / `decline_catering_quote(reason)` | partener | quote_status `requested→quoted/declined` |
| `confirm_catering_quote` | clientul comenzii | `quoted→confirmed`, orders → `accepted`, total = ofertă |

Toate scriu audit în `delivery_status_events` (fără policy de INSERT — doar RPC-urile pot scrie istorie). Ciclu comandă: `pending_restaurant → accepted → ready_for_pickup → courier_assigned → picked_up → en_route → delivered` (+ `cancelled`/`rejected`). Catering: quote-first, apoi același pipeline.

## Realtime

Tabele publicate (migrația 000700 — fără asta subscripțiile NU primesc nimic): `orders`, `catering_details`, `delivery_status_events`.
- `subscribeTable()` (`src/lib/realtime/`): canale unice per mount, filtrate pe rând (`id=eq.X`), callback de status pentru degradare.
- GPS curier: Broadcast pe canal `order:{id}:location` (~10s) + UPSERT `courier_locations` (~45s) pentru last-known. Client: `useCourierLocation` (seed-ul nu suprascrie broadcast-ul).

## Date (migrații `supabase/migrations/`, ordinea contează)

000000 profiles+has_role · 000100 couriers(+locations) · 000200 restaurants/menu/hours/staff · 000300 addresses · 000400 orders/order_items/catering_details (+ policies curier) · 000500 events+RPC-uri · 000600 storage `restaurant-photos` · 000700 realtime publication · 000800 hardening funcții (revoke anon; has_* rămân anon pt RLS pe browsing) · 000900 curier citește adresa comenzii asignate · 001000 fix recursiune RLS · 001100 indexuri perf · 001200 curier citește catering_details asignate.

## Aplicații mobile (`mobile/`, toolchain propriu, exclus din build-ul web)

- `client/`: browse+meniu live, coș local, `place_order` real, comenzile mele; identitate luxury sincronizată (serif, tinturi).
- `driver/`: login, feed comenzi disponibile (poll 15s), accept prin `assign_courier`, swipe-uri → `advance_delivery_status` (+confirm încasare), istoric+câștiguri, resume livrare activă.
- Adaptorul `src/lib/api.ts` din fiecare app traduce schema → tipurile UI existente.

## Operare locală

- Server web: launchd `com.chisinau-delivery.server` port 3000; după build: `launchctl kickstart -k gui/501/com.chisinau-delivery.server`; log `/tmp/chisinau-delivery-server.log`.
- Verifier per iterație: `npm run build` + `npm run lint` + smoke pe rute + screenshot; workflow adversarial la schimbări mari.
- Memoria buclei: `.bucla/` (protocol global `~/.claude/commands/bucla.md`).
- Conturi test (`parola123`): client@ / partener@ / curier@ test.md. Deploy: NUMAI cu OK explicit.

## Datorii cunoscute (vezi `.bucla/issues.md`)

`/enter/[role]` demo-doorway (șters la lansare) · fără teste automate · `SUPABASE_SERVICE_ROLE_KEY` absent (invite-uri admin) · 404 pe slug inexistent servește 200 pe shell-ul streamed (cosmetic).
