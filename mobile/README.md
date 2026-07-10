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
