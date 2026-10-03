# Coji web peste src/ — dovada spike-ului (2026-10-03)

Context: decizia din seară a mutat clientul și curierul pe NATIV (Expo/EAS). Cojile web rămân mecanismul pentru **restaurant (:3003)** și **master (:4004→3004)**. Spike-ul `apps/client` a dovedit mecanismul end-to-end într-un worktree; fișierele NU sunt în repo — acest document păstrează ce s-a învățat ca să nu fie plătit din nou.

Registrul de rute e în cod: `src/lib/apps/registry.ts` (8 teste). Harta completă a rutelor (cartograf) e în `.bucla/` nu aici; riscurile ei sunt mai jos.

## Ce a funcționat (worked = True)

- cp -cR /Users/user/code/chisinau-delivery/node_modules ./node_modules -> 3.6s; node_modules/@chisinau/{shared-api,shared-types} are RELATIVE symlinks -> resolve to the worktree's packages/. packages/*/node_modules: none exist.
- bash scratchpad/sbenv.sh -> keys NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL; URL http://127.0.0.1:54421 (secrets never printed)
- build #1 (apps/client) -> FAIL: 'apps/client/app/(customer)/error.tsx must be a Client Component. Add the "use client" directive' -> fixed by adding "use client" to the shell file
- build #2 -> '✓ Compiled successfully', routes: ƒ / , ƒ /api/menu-search, ƒ /cart, ƒ /devino-partener, ƒ /login, ○ /manifest.webmanifest, ƒ /restaurants, ƒ /restaurants/[slug], 'ƒ Proxy (Middleware)'
- probe.py on :3101 (build #2) -> FAIL 'tailwind utilities from src present': CSS had only `.transform` in @layer utilities (Tailwind scanned from cwd=apps/client)
- debug: root postcss.config.mjs IS the one used, but Turbopack evaluates it with import.meta.dirname=undefined and a bogus import.meta.url=.../apps/postcss.config.mjs -> base can't be pinned from the config file; apps/client/postcss.config.mjs (base option) had no effect -> deleted
- fix: src/app/globals.css `@import "tailwindcss" source("../..");` -> shell CSS 88KB, .max-w-5xl present
- monolith no-op proof: worktree root `next build` WITH change -> csssig 'files 3 bytes 107004 sha 32d92377b7220e13 selectors 823'; WITHOUT change (git show HEAD:src/app/globals.css) -> 'files 3 bytes 107004 sha 32d92377b7220e13 selectors 823' (byte-identical)
- final clean build apps/client -> '✓ Compiled successfully in 1381ms', 'Finished TypeScript in 1997ms', no warnings
- lsof :3101 -> 'node 47970 TCP 127.0.0.1:3101 (LISTEN)' (127.0.0.1 only)
- python3 probe.py http://localhost:3101 -> FAILS: [] ; key lines: '/ 200 len=30794'; '/restaurants 200 slugs=[amber-bistro, bamboo-roll, ciocana-grill-house, fusion-kitchen, le-jardin, le-petit-chef] names=[Amber Bistro, Bamboo Roll, Ciocana Grill House, ...]'; 'tailwind utilities from src present size=96432'; '/restaurants/amber-bistro 200 title=Amber Bistro — Fine dining, livrare în Chișinău · Dragons Delivery Chișinău'; '/deliveries -> 307 location=http://localhost:3002/deliveries'; '/deliveries/abc?x=1 -> http://localhost:3002/deliveries/abc?x=1'; '/earnings -> :3002'; '/restaurant/menu -> http://localhost:3003/restaurant/menu'; '/platform, /master -> :3004'; '/cart 200'; '/login 200'; '/api/menu-search?q=rol 200 application/json items=30 first=Bamboo Dragon Roll @ Bamboo Roll'; '/manifest.webmanifest name=Dragons Delivery — Client'; '/icon-192.png 200 image/png' (public symlink); '/sw.js cache-control=no-cache' (headers() inherited from root next.config); '/orders 404' (not in shell yet)
- compare.py :3000 vs :3101 -> /api/menu-search?q=sushi returns {"items":[]} on BOTH (baseline data: no dish matches 'sushi'), so probe uses q=rol; bad slug -> 200 + <meta robots noindex> (streamed notFound under (customer)/loading.tsx Suspense)
- node e2e.mjs http://localhost:3101 http://localhost:3102 -> 'after login url: http://localhost:3101/restaurants'; 'auth cookies: sb-127-auth-token@localhost'; 'signed-in nav (Comenzile mele) server-rendered: true'; 'logged-in server action POST: http://localhost:3101/devino-partener status=200 next-action=60e8177e8fb0…'; 'logged-in action result shown: Nume și telefon sunt obligatorii.' (requireUser passed => cookie reached the action; validation reject => no DB row written); '/deliveries: 307 -> http://localhost:3002/deliveries'; 'signed-in on http://localhost:3102 with the cookie from http://localhost:3101: true' (real cross-port session share); 'anon: signed-in nav: false' (control)
- root tsc: node node_modules/typescript/bin/tsc --noEmit -> exit=0 (root tsconfig DOES include apps/client/** incl. apps/client/.next/types/routes.d.ts via next-env import; both root and shell routes.d.ts declare global PageProps/LayoutProps but skipLibCheck skips .d.ts so no duplicate-identifier error). Also exit=0 with apps/client/.next absent and with root .next present.
- apps tsc: tsc --noEmit -p apps/client -> exit=0
- vitest (worktree root) -> 'Test Files 24 passed (24) Tests 214 passed (214)'
- eslint apps (before ignore fix) -> '✖ 6917 problems (394 errors, 6523 warnings)' all from apps/client/.next/** ; after adding 'apps/*/.next/**' + 'apps/*/next-env.d.ts' to globalIgnores -> clean, exit 0
- git status -> M .gitignore, M eslint.config.mjs, M src/app/globals.css, ?? apps/ (20 files + public symlink); apps/client/.next ignored by new '/apps/*/.next/' rule; apps/client/next-env.d.ts ignored by existing 'next-env.d.ts' rule
- cleanup: TaskStop on :3101 and :3102 servers; lsof :3101/:3102 -> no listeners; :3000 (pid 97732) and :3007 (pid 82360) still on 127.0.0.1, untouched; worktree root .next removed. Nothing committed, no deps/lockfile changes, no DB writes, (customer)/orders/page.tsx untouched.

## Capcane (fiecare a costat un build)

- Tailwind v4 scans from process.cwd() by default. A shell builds with cwd=apps/client, so ALL utility classes used in ../../src silently disappear: the build stays green, pages return 200, and the UI is unstyled. A config `base` can't fix it: Turbopack uses the ROOT postcss.config.mjs (found by walking up from src/app/globals.css) and evaluates it with import.meta.dirname=undefined and a fake import.meta.url, and an app-level postcss.config is ignored. Working fix: `@import "tailwindcss" source("../..")` in src/app/globals.css. Verified as a byte-identical no-op for the monolith CSS (same sha256).
- error.tsx (any file that must be a Client Component) needs its own "use client" in the shell file. Next checks the directive on the file it reads, not on the re-export target. Build error: 'must be a Client Component'.
- Route segment config (runtime, dynamic, and also proxy `config.matcher`) must be written as literals in the shell file. They are statically analysed, so a re-export is ignored. menu-search/route.ts restates runtime + dynamic, and the shell proxy.ts restates the matcher. Both copies must be kept in sync with src by hand.
- generateMetadata re-exports fine (`export { default, generateMetadata }`). The restaurant page title rendered correctly through the shell.
- Route-group layouts are re-created by mirroring the group folders: (customer)/layout, (customer)/restaurants/layout, plus error/loading/not-found. Leaving out (customer)/restaurants/layout drops the premium.css import, because that layout exists only to import the CSS.
- The root layout is reused with `export { default, viewport } from "@/app/layout"`. That brings next/font, globals.css, AuthListener and ServiceWorkerRegister from src. metadata is spread from the monolith and overridden.
- public/ does not exist per app. A symlink apps/client/public -> ../../public works: icons, sw.js and /videos are served. Next still applies the sw.js no-cache header because the shell's next.config spreads the root config.
- Root `npm run lint` breaks as soon as a shell has been built: eslint-config-next's '.next/**' ignore only covers the root, so apps/client/.next produced 394 errors. Fixed with globalIgnores 'apps/*/.next/**' and 'apps/*/next-env.d.ts'. The root .gitignore '/.next/' is also anchored, so '/apps/*/.next/' was added.
- Root tsc is NOT broken by apps/ (exit 0), but it does type-check the shell files and apps/client/.next/types/routes.d.ts. Both the root and shell routes.d.ts declare global PageProps/LayoutProps with different route unions. That passes only because skipLibCheck skips .d.ts files. Suggested hardening, not applied: add "apps" to the root tsconfig exclude and give each app its own `tsc -p apps/<name>`, which already passes.
- Cookie host: redirect targets default to http://localhost:300x. A user who browses the shell at 127.0.0.1:3001 has the session cookie on host 127.0.0.1, which is never sent to localhost:3002, so they arrive logged out. Verified: via 127.0.0.1:3101, /deliveries still redirects to localhost:3002. Always use localhost, or add a canonical-host redirect from 127.0.0.1 to localhost in the shell proxy.
- Server Action IDs are per build (60e8… vs 606e… across two builds of the same code). Each app also gets its own action-encryption key. This is fine while every page posts only to its own app. If two apps must share actions, or run more than one instance, set NEXT_SERVER_ACTIONS_ENCRYPTION_KEY.
- The login form is client-side supabase.auth.signInWithPassword, not a Server Action. To prove a real Server Action I used devino-partener submitApplication with whitespace-only fields: requireUser() passes and then validation rejects, so no row is written. The anon control shows no signed-in nav.
- A bad /restaurants/<slug> returns 200 + noindex, not 404, because notFound() is streamed under the (customer)/loading.tsx Suspense. This is inherited monolith behaviour, not a shell bug.
- With the dev autologin in src/proxy.ts, `next start` builds are production, so autologin stays off unless LOCAL_NO_LOGIN=1 is set and the request comes from localhost. `next dev` shells (scripts use -p 3001 dev) will autologin as client on customer surfaces, same as the monolith.
- The worktree guard refuses compound shell commands (cd + source, sed with variables, loops with vars). Put build/start/env steps in scratchpad scripts and call them with literal absolute paths.
- Using page.goto waitUntil:'networkidle' never settles on /restaurants (persistent connections), so use 'load'.
- /api/menu-search?q=sushi returns [] on the monolith :3000 too (seed data). Use q=rol to prove non-empty JSON.

## Întrebări rămase deschise

- Hoist the FOREIGN ownership map into a shared module (e.g. src/lib/apps/owners.ts) so all 4 shells read one table. Left inline in apps/client/proxy.ts for the spike.
- Should /api/platform redirect (307 keeps the method, but a cross-origin fetch would hit CORS), or should each app only expose its own /api routes and 404 the rest?
- Should the proxy canonicalize 127.0.0.1 to localhost so the cookie-sharing guarantee can't be broken by the address the user typed?
- Root tsconfig: exclude apps/ (each app typechecks itself) or keep relying on skipLibCheck to hide the duplicate global route types? It currently passes either way.
- scripts/check-local-exposure.sh does not exist in this worktree's HEAD (it is in the main repo's newer CLAUDE.md), so npm run verify's exposure step could not be run here. :3101/:3102 were verified bound to 127.0.0.1 via lsof.

## Fișierele cojii `apps/client` (șablon pentru restaurant/master)

### `apps/client/package.json`

```
{
  "name": "@chisinau/app-client",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "node ../../node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3001",
    "build": "node ../../node_modules/next/dist/bin/next build",
    "start": "node ../../node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3001",
    "typecheck": "node ../../node_modules/typescript/bin/tsc --noEmit -p ."
  }
}
```

### `apps/client/next.config.ts`

```
import path from "node:path";
import type { NextConfig } from "next";
import base from "../../next.config";

// Thin shell: the monolith config (transpilePackages, sw.js header) is the
// single source; only the roots move up to the repo so ../../src compiles.
const root = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  ...base,
  turbopack: { ...base.turbopack, root },
  outputFileTracingRoot: root,
};

export default nextConfig;
```

### `apps/client/tsconfig.json`

```
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["../../src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

### `apps/client/next-env.d.ts`

```
/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

### `apps/client/public`

```
SYMLINK -> ../../public   (created with: ln -s ../../public apps/client/public)
```

### `apps/client/proxy.ts`

```
import { NextResponse, type NextRequest } from "next/server";
import { proxy as monolithProxy } from "@/proxy";

// Path ownership: a path that belongs to another app goes to THAT app's origin,
// same path + query. The Supabase cookie is host-scoped (cookies ignore ports),
// so the session follows across :3001-:3004 without any handoff.
// ponytail: map lives here for the spike; hoist to src/lib/apps when the
// other three shells need the same table.
const FOREIGN: { origin: string; paths: string[] }[] = [
  { origin: process.env.APP_ORIGIN_CURIER ?? "http://localhost:3002", paths: ["/deliveries", "/earnings"] },
  { origin: process.env.APP_ORIGIN_RESTAURANT ?? "http://localhost:3003", paths: ["/restaurant"] },
  { origin: process.env.APP_ORIGIN_MASTER ?? "http://localhost:3004", paths: ["/platform", "/master", "/api/platform"] },
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Segment match: "/restaurant" owns "/restaurant/menu", never "/restaurants".
  const owner = FOREIGN.find((o) => o.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`)));
  if (owner) {
    const to = new URL(owner.origin);
    to.pathname = pathname;
    to.search = search;
    return NextResponse.redirect(to);
  }
  // Own path: monolith proxy as-is (updateSession token rotation + dev autologin).
  return monolithProxy(request);
}

// Must be a literal here — Next statically reads `config` from this file.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
```

### `apps/client/app/layout.tsx`

```
import type { Metadata } from "next";
import { metadata as monolith } from "@/app/layout";

// Thin shell: fonts, globals.css, AuthListener and the SW register all come
// from the monolith root layout. Only the app identity differs.
export { default, viewport } from "@/app/layout";

export const metadata: Metadata = {
  ...monolith,
  applicationName: "Dragons Delivery",
  manifest: "/manifest.webmanifest",
};
```

### `apps/client/app/manifest.ts`

```
import type { MetadataRoute } from "next";
import monolith from "@/app/manifest";

// Client app PWA: same icons/colors as the monolith, own identity + start page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    ...monolith(),
    id: "/?app=client",
    name: "Dragons Delivery — Client",
    short_name: "Dragons",
    description: "Comandă sushi, fine dining și catering în Chișinău.",
    start_url: "/restaurants",
    scope: "/",
  };
}
```

### `apps/client/app/not-found.tsx`

```
export { default } from "@/app/not-found";
```

### `apps/client/app/(marketing)/page.tsx`

```
export { default } from "@/app/(marketing)/page";
```

### `apps/client/app/(customer)/layout.tsx`

```
export { default } from "@/app/(customer)/layout";
```

### `apps/client/app/(customer)/error.tsx`

```
"use client";

// Next checks the directive on the file it reads, not on the re-export target.
export { default } from "@/app/(customer)/error";
```

### `apps/client/app/(customer)/loading.tsx`

```
export { default } from "@/app/(customer)/loading";
```

### `apps/client/app/(customer)/not-found.tsx`

```
export { default } from "@/app/(customer)/not-found";
```

### `apps/client/app/(customer)/restaurants/layout.tsx`

```
export { default } from "@/app/(customer)/restaurants/layout";
```

### `apps/client/app/(customer)/restaurants/page.tsx`

```
export { default } from "@/app/(customer)/restaurants/page";
```

### `apps/client/app/(customer)/restaurants/[slug]/page.tsx`

```
export { default, generateMetadata } from "@/app/(customer)/restaurants/[slug]/page";
```

### `apps/client/app/(customer)/cart/page.tsx`

```
export { default } from "@/app/(customer)/cart/page";
```

### `apps/client/app/(customer)/devino-partener/page.tsx`

```
export { default } from "@/app/(customer)/devino-partener/page";
```

### `apps/client/app/login/page.tsx`

```
export { default } from "@/app/login/page";
```

### `apps/client/app/api/menu-search/route.ts`

```
export { GET } from "@/app/api/menu-search/route";

// Segment config must be a literal in the file Next reads — a re-export is not
// statically analysable, so it is restated here (keep in sync with the source).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```


## Riscuri din harta de rute (cartograf)

- PREFIX COLLISION: '/restaurant' vs '/restaurants' (client) vs '/start/restaurant' (client). Ownership matcher must be segment-based (path === p || startsWith(p + '/')); the existing proxy already special-cases '/restaurant/' with trailing slash, and '/earnings' is EXACT (no /earnings/* routes exist).
- COOKIE HOST: Supabase auth cookie is host-scoped, port-agnostic, name derived from NEXT_PUBLIC_SUPABASE_URL host. If a user is on 127.0.0.1:3001 and the redirect goes to localhost:3002 the session is lost. Cross-app redirects MUST reuse the incoming hostname and only swap the port. Also isLocalRequestHost accepts both, so autologin would silently create a second session on the other hostname.
- PROXY LOOP: dev autologin 'role !== requiredRoles[0] -> signInAs' switches accounts when an admin enters a courier/restaurant path; with 4 apps and shared cookie, moving curier(:3002) -> master(:3004) -> curier re-signs-in each hop (session thrash, GoTrue reuse detection / token rotation races). Define one logout/switch policy; platform_admin 'view as' must NOT go through signInAs.
- router.push CANNOT cross origins: LoginForm (:58), SignOutButton (:35), OfferCard, CheckoutForm etc. use router.push with own-app paths (fine) but LoginForm ROLE_HOME/next and the hub tiles/doorways point at foreign paths. Need an owner-aware navigator (absolute URL + window.location) or rely on proxy ownership redirect (extra round-trip, works for GET only; POST doorways /enter and /master/enter respond 303 -> GET so fine).
- next param: proxy writes login?next=pathname without the query string and login drops it; an ownership redirect that preserves search is required, but next after login to a foreign-owned path flows through LoginForm -> proxy redirect: acceptable but unverified.
- SHARED LAYOUT SPLIT: (admin)/layout.tsx serves both /platform and /restaurant by role; re-exporting it into restaurant shell would expose platform links to platform_admin and run 3 admin count queries only for admin. Needs a forked/partner-only variant WITHOUT editing the monolith layout (nothing dies) - either new component under src/ that the monolith ignores, or app-local layout composing shared header pieces. Same for (admin)/error.tsx, loading.tsx.
- TAILWIND v4 SOURCE DETECTION: src/app/globals.css has no @source; PostCSS plugin scans from the project base (app dir). Utility classes used only in ../../src/components would be missing -> unstyled pages that still build green. Add @source '../../../src' in each app's css and verify visually (Rule: visual work needs eyes).
- TURBOPACK ROOT / transpile: next.config turbopack.root=__dirname and transpilePackages for @chisinau/shared-* must be replicated in each apps/*/next.config.ts with root = monorepo root, else imports from ../../src are rejected ('outside of project root'). tsconfig paths '@/*' must point to ../../src/*. No new deps and no lockfile change: apps cannot be npm workspaces with own package.json deps; use root node_modules (run 'next dev' from app dir with root resolution) - verify that resolution works before building shells.
- SYMLINKED public/: symlinks to ../../public may be ignored by next build/output tracing; copies are safe but duplicate 2-8 MB mp4 files x3.
- SERVER ACTIONS: action ids are hashed per build; same action module compiled in 4 apps is fine, but a form rendered on app A must POST to app A (it does, relative). revalidatePath calls only touch own-app paths today (verified: no cross-app revalidatePath) so no change needed, but caches are now per app.
- PWA/PUSH: four origins = four SW registrations, four push subscriptions per user; existing monolith subscriptions on :3000/:3007 keep working (nothing dies) but a user subscribed on :3000 AND :3002 gets duplicate pushes. Push url is relative; openWindow on the SW origin. Notification for a restaurant partner subscribed on :3007 stays monolith. /api/push/drain must remain on :3000 only (pg_net target is hardcoded host.docker.internal:3000 in seeds/migration).
- DOCKER REACH: autologin comment says Colima VM reaches the app via host.docker.internal; new ports 3001-3004 bound to 127.0.0.1 only are fine, do NOT bind 0.0.0.0. check-local-exposure.sh regex must be extended or it will not catch an accidental 0.0.0.0 bind on the new ports.
- CROSS-OWNERSHIP IMPORTS: components import server actions via '@/app/(group)/...' and customer restaurants layout imports '@/app/(admin)/restaurant/premium.css'. Moving/renaming anything under src/app breaks the monolith; shells must only re-export, never move. src/app/(customer)/orders/page.tsx is owned by another session: client shell must re-export it (export { default } from ...) without touching it; page-level exports like revalidate/dynamic/metadata must be re-declared literally in the shell (Next segment config must be literal, see memory 'next-segment-config-must-be-literal'): sitemap.ts has 'export const revalidate = 3600', api routes have runtime/dynamic consts -> re-export of those consts will be rejected, copy the literals.
- '/' DEFINITION: curier/restaurant/master have no root page today; brand Link href='/', SignOutButton push('/'), proxy wrong-role redirect '/', enter GET redirect '/', not-found '/' all assume a hub. In a non-client app '/' needs an explicit page/redirect or users land on a 404 after sign-out. Sign-out in curier then redirecting to client origin '/' vs own root is a product decision.
- NEXT_PUBLIC_SITE_URL default http://localhost:3007 leaks into metadataBase/openGraph/sitemap of every app unless set per app.
- MASTER DOORWAY cookie 'master_gate' (httpOnly, path '/') is shared across ports; /master/auth failure Map is per-process memory. /master/enter signs the browser into ANOTHER role's seeded account (session overwrite) - with 'view as' being new, distinguish impersonation (read-only, audited) from this doorway (full login) to avoid shipping a second write-capable impersonation path.
- BUILD/VERIFY GATES: root tsconfig include '**/*.ts(x)' will typecheck apps/**; root 'npm run build' builds only the monolith; 'npm run verify' (tsc + vitest + exposure check) is the gate and the exposure script ports must include 3001-3004; check-doc-drift/facts.sh count 'web route groups' - adding apps may trip the Counted-facts block in CLAUDE.md (edit via scripts/facts.sh, not by hand).
