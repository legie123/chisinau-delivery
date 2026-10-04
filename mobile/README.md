# Mobile — Dragons Couriers (Expo/React Native)

Integrat din [Zmocolini/dragons-couriers](https://github.com/Zmocolini/dragons-couriers). Două aplicații Expo separate, prototipuri UI cu date mock:

- `client/` — aplicația clientului: Home, Search, Restaurant, Cart, Orders, Profile
- `driver/` — aplicația curierului: Map, ActiveDelivery, OrdersHistory, Earnings, Profile

## Rulare

```bash
cd mobile/client   # sau mobile/driver
npm install
npm start          # Expo dev server; scanează QR cu Expo Go
```

## Stare & următorii pași

- Ecranele folosesc **date mock hardcodate** — nu sunt conectate la backend.
- Backend-ul real al platformei e Supabase (`../supabase/` — schema, RLS, RPC-uri).
  Conectarea = înlocuirea mock-urilor cu `@supabase/supabase-js` + auth
  (aceleași RPC-uri ca web-ul: `place_order`, `assign_courier`, `advance_delivery_status` etc.).
- `API_BASE_URL` din `src/theme.ts` e configurabil prin `EXPO_PUBLIC_API_BASE_URL`.
- Tema Dragons (navy `#0D0D1F`, roșu `#E94560`, gold `#F5A623`) din `src/theme.ts`
  e portată și pe web (`../src/app/globals.css`).

Aplicațiile mobile NU intră în build-ul Next.js (excluse din `tsconfig.json`).

## client/ — aplicația nativă „Dragons Delivery" (2026-10-03)

Live pe Supabase prin `@chisinau/shared-api` / `shared-types` / `shared-domain` (citite direct
din `../../packages` prin `metro.config.js` + `tsconfig.json` paths — fără `npm install` la rădăcină).

- Config (obligatoriu, altfel ecran roșu la pornire): `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`; opțional `GOOGLE_MAPS_ANDROID_API_KEY` (hartă Android),
  `EAS_PROJECT_ID` (push). Local în `.env.local`; pe EAS: `eas env:create`.
- Verificare: `npm run typecheck`, `npm test` (vitest din rădăcină),
  `npx expo export --clear --platform android|ios` (`--clear`: cache-ul Metro nu ține cont de `EXPO_PUBLIC_*`), `npm run smoke:order` (comandă reală pe Supabase-ul
  local, apoi anulată; scriptul tipărește id-urile de curățat).
- Build: `eas init` (o dată) → `eas build --profile preview --platform android|ios` din `mobile/client`.
  EAS urcă tot repo-ul git, deci `packages/` ajunge în build.
