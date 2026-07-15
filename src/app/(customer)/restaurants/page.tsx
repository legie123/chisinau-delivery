import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RestaurantBrowser } from "@/components/customer/RestaurantBrowser";
import type { Restaurant } from "@/lib/types/domain";

export default async function RestaurantsPage() {
  const supabase = await createClient();
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return (
      <main className="flex-1 px-5 py-10">
        <p className="text-red-500">Nu am putut încărca restaurantele: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="flex-1 px-5 pb-24 pt-6">
      {/* Hero promo — Bolt-style banner, Dragons brand */}
      <Link
        href="/catering"
        className="mb-6 block overflow-hidden rounded-2xl p-6"
        style={{ background: "linear-gradient(120deg, #16213e 0%, #1a1a2e 55%, #e94560 160%)" }}
      >
        <p className="text-xs font-bold uppercase tracking-widest text-gold">Dragons Delivery</p>
        <h1 className="mt-1 max-w-md text-2xl font-bold leading-snug text-white sm:text-3xl">
          Sushi premium & fine dining, livrate rapid în Chișinău
        </h1>
        <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-gold">
          Catering pentru evenimente
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
          </svg>
        </p>
      </Link>

      <RestaurantBrowser restaurants={(restaurants ?? []) as Restaurant[]} />
    </main>
  );
}
