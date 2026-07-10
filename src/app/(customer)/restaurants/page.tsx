import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Restaurant } from "@/lib/types/domain";

const CUISINE_LABEL: Record<Restaurant["cuisine_type"], string> = {
  sushi: "Sushi",
  fine_dining: "Fine dining",
  other: "Altele",
};

export default async function RestaurantsPage() {
  const supabase = await createClient();
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return (
      <main className="flex-1 px-6 py-10">
        <p className="text-red-600">Nu am putut încărca restaurantele: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Restaurante din Chișinău</h1>
      {restaurants?.length === 0 ? (
        <p className="text-zinc-500">Niciun restaurant disponibil momentan.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {restaurants?.map((restaurant: Restaurant) => (
            <Link
              key={restaurant.id}
              href={`/restaurants/${restaurant.slug}`}
              className="rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
            >
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-medium">{restaurant.name}</h2>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                  {CUISINE_LABEL[restaurant.cuisine_type]}
                </span>
              </div>
              {restaurant.description && (
                <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {restaurant.description}
                </p>
              )}
              <p className="text-xs text-zinc-500">
                {restaurant.sector ?? restaurant.address} · livrare {restaurant.delivery_fee_mdl} MDL
                · minim {restaurant.min_order_amount_mdl} MDL
              </p>
              {!restaurant.accepting_orders && (
                <p className="mt-2 text-xs font-medium text-amber-600">Nu acceptă comenzi acum</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
