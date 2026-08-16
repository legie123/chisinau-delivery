import { createClient } from "@/lib/supabase/server";
import { getPrepEstimates } from "@chisinau/shared-api";
import { RestaurantBrowser } from "@/components/customer/RestaurantBrowser";
import type { PrepEstimate, Restaurant } from "@/lib/types/domain";

import { chisinauNow, isOpenNow, type HoursRow } from "@/lib/orders/hours";

export default async function RestaurantsPage() {
  const supabase = await createClient();
  const { dow, time } = chisinauNow();
  const prevDow = (dow + 6) % 7;

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
    supabase
      .from("restaurant_hours")
      .select("restaurant_id, day_of_week, opens_at, closes_at, is_closed")
      .in("day_of_week", [dow, prevDow]),
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

  if (error) {
    return (
      <main className="flex-1 px-5 py-10">
        <p className="text-red-500">Nu am putut încărca restaurantele: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="flex-1 px-5 pb-24 pt-6">
      {/* Luxury brand header — Dragons Alliance Premium reference.
          Subtitlul „Premium Food Delivery" a fost scos (2026-08-16): engleză pe
          o interfață în română, sub un titlu care spune deja același lucru, pe o
          platformă care de la `5c885e8` nu mai e doar livrare de mâncare, ci
          rețea de locuri (spa, lounge, săli). O linie care nu adaugă informație
          și contrazice produsul consumă doar din primul ecran al telefonului. */}
      <div className="mb-6 flex flex-col items-center gap-1 py-4 text-center">
        <span className="text-4xl" aria-hidden>🐉</span>
        <h1 className="font-serif text-3xl font-bold tracking-wide text-gold">DRAGONS DELIVERY</h1>
      </div>

      <RestaurantBrowser
        restaurants={restaurantList}
        estimates={estimates}
        favoriteIds={favoriteIds}
        openNowIds={openNowIds}
        customerId={user?.id ?? null}
      />
    </main>
  );
}
