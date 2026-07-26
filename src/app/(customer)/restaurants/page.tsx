import { createClient } from "@/lib/supabase/server";
import { getPrepEstimates } from "@chisinau/shared-api";
import { RestaurantBrowser } from "@/components/customer/RestaurantBrowser";
import type { PrepEstimate, Restaurant } from "@/lib/types/domain";

// "Now" in Europe/Chisinau service time → today's day_of_week (0=Sun..6=Sat)
// and a "HH:MM:SS" clock string that compares lexically against Postgres `time`.
function chisinauNow(): { dow: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Chisinau",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[get("weekday")] ?? 0, time: `${get("hour")}:${get("minute")}:${get("second")}` };
}

type HoursRow = { restaurant_id: string; opens_at: string; closes_at: string; is_closed: boolean };

export default async function RestaurantsPage() {
  const supabase = await createClient();
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("is_active", true)
    .order("name");

  // WS4 — one RPC call for live prep estimates across the whole list (anon-safe).
  const restaurantList = (restaurants ?? []) as Restaurant[];
  const prepRows = await getPrepEstimates(supabase, restaurantList.map((r) => r.id));
  const estimates: Record<string, PrepEstimate> = {};
  for (const row of (prepRows ?? []) as PrepEstimate[]) {
    estimates[row.restaurant_id] = row;
  }

  // Customer favorites (empty for anon) — powers the heart state + the customer_id
  // the direct favorites write needs. customerId null ⇒ browser hides the hearts.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let favoriteIds: string[] = [];
  if (user) {
    const { data: favs } = await supabase.from("favorites").select("restaurant_id").eq("customer_id", user.id);
    favoriteIds = (favs ?? []).map((f) => f.restaurant_id as string);
  }

  // "Deschis acum" — compute server-side from today's hours in service time.
  const { dow, time } = chisinauNow();
  const prevDow = (dow + 6) % 7;
  // Fetch today's AND yesterday's rows — an overnight window (e.g. 22:00–02:00) is
  // stored under the day it STARTS, so at 01:00 today it lives on yesterday's row.
  // (audit #15 — mirrors the SQL restaurant_open_at fix.)
  const { data: hoursRows } = await supabase
    .from("restaurant_hours")
    .select("restaurant_id, day_of_week, opens_at, closes_at, is_closed")
    .in("day_of_week", [dow, prevDow]);
  const openNowIds = ((hoursRows ?? []) as (HoursRow & { day_of_week: number })[])
    .filter((h) => {
      if (h.is_closed) return false;
      const overnight = h.closes_at <= h.opens_at;
      if (h.day_of_week === dow) {
        // today's window: same-day range, or the evening part of an overnight span
        return overnight ? time >= h.opens_at : time >= h.opens_at && time <= h.closes_at;
      }
      // yesterday's overnight window still running after midnight
      return overnight && time <= h.closes_at;
    })
    .map((h) => h.restaurant_id);

  if (error) {
    return (
      <main className="flex-1 px-5 py-10">
        <p className="text-red-500">Nu am putut încărca restaurantele: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="flex-1 px-5 pb-24 pt-6">
      {/* Luxury brand header — Dragons Alliance Premium reference */}
      <div className="mb-6 flex flex-col items-center gap-1 py-4 text-center">
        <span className="text-4xl" aria-hidden>🐉</span>
        <h1 className="font-serif text-3xl font-bold tracking-wide text-gold">DRAGONS DELIVERY</h1>
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/45">
          Premium Food Delivery
        </p>
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
