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
      {/* Luxury brand header — Dragons Alliance Premium reference */}
      <div className="mb-6 flex flex-col items-center gap-1 py-4 text-center">
        <span className="text-4xl" aria-hidden>🐉</span>
        <h1 className="font-serif text-3xl font-bold tracking-wide text-gold">DRAGONS DELIVERY</h1>
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/45">
          Premium Food Delivery
        </p>
      </div>

      <RestaurantBrowser restaurants={(restaurants ?? []) as Restaurant[]} />
    </main>
  );
}
