# Mobile (courier + client) — human runbook

Native apps: `mobile/driver` (courier) and `mobile/client` (customer), Expo 54, built in the
cloud with EAS. This Mac has no Xcode/Android Studio/JDK; every native build is `eas build`.

## One-time setup (human)
1. Create an Expo account (expo.dev). `npm i -g eas-cli` (global install, acceptable) then `eas login`.
2. In each app dir: `cd mobile/driver && eas init` (writes the project id used for Expo push tokens;
   set `EAS_PROJECT_ID`), same for `mobile/client`.
3. Store the Supabase config as EAS environment variables (names only, values from the tunnel
   or the real project; never commit them):
   `eas env:create --environment development --name EXPO_PUBLIC_SUPABASE_URL --visibility sensitive`
   and the same for `EXPO_PUBLIC_SUPABASE_ANON_KEY`, for `development`, `preview`, `production`.
   The dev client also reads them from the shell at `expo start` (see dev.sh), so the
   tunnel URL does not need to be baked into the build.
4. Business decisions (not technical): Apple Developer Program 99 USD/yr (needed for any iOS
   device build/push), Google Play Console 25 USD one-time (store only; APK sideload is free).

## Dev loop with the local backend (short sessions only)
```
supabase start
brew install cloudflared            # tunnel.sh exits 2 and prints this if missing
scripts/mobile/tunnel.sh [minutes]  # default 90; writes mobile/.tunnel.env; self-destructs at TTL
scripts/mobile/dev.sh driver        # or client; --tunnel instead of --lan if the phone is off the Wi-Fi
scripts/mobile/tunnel-down.sh       # stop early
```
`dev.sh` refuses to start if `mobile/.tunnel.env` is missing or older than its TTL.

## Build and install the dev client (once per native change)
```
cd mobile/driver
eas build --profile development --platform android   # APK, install via the QR/link EAS prints
eas build --profile development --platform ios       # needs Apple Developer + device registered (eas device:create)
```
Open the installed "Dragons Curier" app, scan the QR from `dev.sh`. Expo Go cannot run these apps
(background location + push need native modules).

## What to check on the phone
- **Push**: log in as a courier; in Supabase local Studio (or `psql`) confirm a row in
  `device_push_tokens` for that user. Copy the `ExponentPushToken[...]` into
  https://expo.dev/notifications and send a test; with the app backgrounded and then killed it must
  show a notification.
- **Background GPS**: go online, accept/start a delivery, lock the phone, walk/drive 5+ min. Check
  `courier_locations` rows keep arriving (timestamps advance while locked), and the customer map
  (`mobile/client` or the web tracking page) follows the courier.
- **Offers in background**: with the courier app backgrounded, create an order; the offer must
  arrive as push, and opening the app must refetch.

## Security note (read before leaving the tunnel up)
The tunnel exposes the LOCAL Supabase API (port 54421 only; not the DB, not Studio) to the
internet at a random `trycloudflare.com` URL. RLS still applies and the anon key is public by
design — BUT the local stack ships with Supabase's **published** default JWT secret, so anyone who
finds the URL can sign a `service_role` token and bypass RLS completely. `tunnel.sh` therefore
**refuses to start** (exit 3) until the secret is rotated:

```
# supabase/config.toml, under [auth]
jwt_secret = "env(SUPABASE_AUTH_JWT_SECRET)"
# shell (keep the value in a gitignored file, never in the repo)
export SUPABASE_AUTH_JWT_SECRET="$(openssl rand -hex 32)"
supabase stop && bash scripts/supabase-up.sh      # anon/service keys are re-derived
```

A conscious one-session override exists (`TUNNEL_ACCEPT_DEFAULT_JWT_SECRET=1`); the TTL is then the
only safety net. `cloudflared` only makes outbound connections; no local port is opened to the LAN.
