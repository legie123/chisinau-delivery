import { createClient } from "@/lib/supabase/server";
import { getPrepEstimates } from "@chisinau/shared-api";
import { RestaurantBrowser } from "@/components/customer/RestaurantBrowser";
import type { PrepEstimate, Restaurant } from "@/lib/types/domain";

import {
  chisinauNow,
  earliestOpening,
  isOpenNow,
  nextOpeningAt,
  openingWhen,
  type HoursRow,
} from "@/lib/orders/hours";
import { SECTORS } from "@/components/immersive/sectors";

export default async function RestaurantsPage() {
  const supabase = await createClient();
  const { dow, time } = chisinauNow();

  // Two network stages instead of five serial ones — on a remote backend every
  // serial await is a full roundtrip. Stage 1: the three independent reads.
  // Hours fetches today's AND yesterday's rows — an overnight window (e.g.
  // 22:00–02:00) is stored under the day it STARTS, so at 01:00 today it lives
  // on yesterday's row (audit #15 — mirrors the SQL restaurant_open_at fix).
  const [{ data: restaurants, error }, { data: { user } }, { data: hoursRows }] = await Promise.all([
    // Doar locurile care LIVREAZĂ mâncare. De când rețeaua a devenit concierge,
    // aici intrau și spa-urile, lounge-urile și sălile de business, etichetate
    // „Restaurant" — un spa în lista de sushi e o promisiune falsă; ele se
    // rezervă din /concierge, nu se comandă.
    supabase
      .from("restaurants")
      .select("*")
      .eq("is_active", true)
      .in("venue_type", ["restaurant", "sushi_bar"])
      .order("name"),
    supabase.auth.getUser(),
    // Săptămâna ÎNTREAGĂ, nu doar azi+ieri (V7): pentru „deschis acum" ajungeau
    // două zile, dar lista spune de-acum și CÂND se deschide, iar `nextOpeningAt`
    // caută doar printre rândurile primite — cu două zile pe masă, un local care
    // deschide mâine ar fi raportat peste șase zile (probat în `hours.test.ts`).
    // Costul e ~7 rânduri × locație în loc de 2, aceeași singură cerere.
    supabase
      .from("restaurant_hours")
      .select("restaurant_id, day_of_week, opens_at, closes_at, is_closed"),
  ]);
  const restaurantList = (restaurants ?? []) as Restaurant[];

  // Stage 2: the two reads that needed stage-1 results — prep estimates (WS4,
  // one RPC across the whole list, anon-safe) + favorites (empty for anon;
  // customerId null ⇒ browser hides the hearts).
  const [prepRows, favoriteIds] = await Promise.all([
    getPrepEstimates(supabase, restaurantList.map((r) => r.id)),
    user
      ? supabase
          .from("favorites")
          .select("restaurant_id")
          .eq("customer_id", user.id)
          .then(({ data }) => (data ?? []).map((f) => f.restaurant_id as string))
      : Promise.resolve([] as string[]),
  ]);
  const estimates: Record<string, PrepEstimate> = {};
  for (const row of (prepRows ?? []) as PrepEstimate[]) {
    estimates[row.restaurant_id] = row;
  }
  const rowsByRestaurant = new Map<string, HoursRow[]>();
  for (const h of (hoursRows ?? []) as HoursRow[]) {
    const list = rowsByRestaurant.get(h.restaurant_id) ?? [];
    list.push(h);
    rowsByRestaurant.set(h.restaurant_id, list);
  }
  const openNowIds = [...rowsByRestaurant.entries()]
    .filter(([, rows]) => isOpenNow(rows, dow, time))
    .map(([id]) => id);

  // V7 — un card închis spunea doar „Închis acum". Ora la care se deschide
  // exista deja (o folosea pagina de meniu, la un clic distanță), dar lipsea
  // exact de unde se ia decizia: din listă. O aducem sus, plus cea mai apropiată
  // deschidere din tot orașul, pentru momentul în care nimic nu e deschis.
  const openingById: Record<string, string> = {};
  const openingsAt: ({ ahead: number; opens: string } | null)[] = [];
  for (const r of restaurantList) {
    if (openNowIds.includes(r.id)) continue;
    const next = nextOpeningAt(rowsByRestaurant.get(r.id) ?? [], dow, time);
    openingsAt.push(next);
    // Un local cu comenzile oprite manual nu are o oră de promis: orarul spune
    // 10:00, dar butonul partenerului spune nu. Tăcere e mai cinstit.
    if (next && r.accepting_orders) {
      openingById[r.id] = `${openingWhen(next.ahead, dow)} la ${next.opens.slice(0, 5)}`;
    }
  }
  const earliest = earliestOpening(openingsAt);
  const earliestLabel = earliest ? `${openingWhen(earliest.ahead, dow)} la ${earliest.opens.slice(0, 5)}` : null;

  if (error) {
    return (
      <main className="flex-1 px-5 py-10">
        <p className="text-red-500">Nu am putut încărca restaurantele: {error.message}</p>
      </main>
    );
  }

  return (
    // `relative isolate`: fără stacking context propriu, stratul de fundal cu
    // -z-10 cade sub fundalul opac al paginii și video-ul rulează nevăzut
    // (capcana plătită pe hub, `(marketing)/page.tsx`).
    <main className="relative isolate flex-1 px-5 pb-24 pt-6">
      {/* Luxury brand header — Dragons Alliance Premium reference.
          Subtitlul „Premium Food Delivery" a fost scos (2026-08-16): engleză pe
          o interfață în română, sub un titlu care spune deja același lucru, pe o
          platformă care de la `5c885e8` nu mai e doar livrare de mâncare, ci
          rețea de locuri (spa, lounge, săli). O linie care nu adaugă informație
          și contrazice produsul consumă doar din primul ecran al telefonului. */}
      {/* Atmosfera sectorului CLIENT, dar fără să-i calce propria regulă. §6 cere
          video DOAR pe deschidere și „niciodată sub listele de restaurante", iar
          aici lista începe la mai puțin de un ecran de sus. `SectorBackdrop` e
          `fixed inset-0`, deci pe pagina asta filmul ar fi stat exact sub liste
          — montat o dată și văzut în captură, nu presupus. Rămâne banda de
          deschidere, în gradientul aceluiași contract (se stinge în `#0a0a14`,
          fundalul paginii, deci n-are muchie), zero octeți și zero mișcare.
          Filmul clientului rămâne unde ecranul CHIAR e o deschidere: hub-ul și
          `/start/client`. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72"
        style={{ background: SECTORS.customer.gradient }}
      />

      {/* Marca se spune O DATĂ. Crestul plus „DRAGONS DELIVERY" repetau, la
          110px din primul ecran de telefon, exact ce scrie bara de navigare cu
          două rânduri mai sus — iar hub-ul (`/`) e locul unde brandul se
          prezintă. Aici titlul spune ce ESTE pagina, deci și omul, și Google
          primesc informație în loc de ecou. */}
      <h1 className="mb-4 font-serif text-2xl font-bold tracking-wide text-white sm:text-3xl">
        Restaurante în Chișinău
      </h1>

      <RestaurantBrowser
        restaurants={restaurantList}
        estimates={estimates}
        favoriteIds={favoriteIds}
        openNowIds={openNowIds}
        openingById={openingById}
        earliestLabel={earliestLabel}
        customerId={user?.id ?? null}
      />
    </main>
  );
}
