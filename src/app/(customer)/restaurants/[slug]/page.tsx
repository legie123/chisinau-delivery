import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AddToCartButton } from "@/components/customer/AddToCartButton";
import type { MenuCategory, MenuItem } from "@/lib/types/domain";

export default async function RestaurantMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (!restaurant) notFound();

  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase.from("menu_categories").select("*").eq("restaurant_id", restaurant.id).order("sort_order"),
    supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("is_available", true)
      .eq("is_catering_only", false)
      .order("sort_order"),
  ]);

  const categoryList = (categories ?? []) as MenuCategory[];
  const itemList = (items ?? []) as MenuItem[];
  const uncategorized = itemList.filter((item) => !item.category_id);

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">{restaurant.name}</h1>
      <p className="mb-6 text-sm text-zinc-500">
        {restaurant.sector ?? restaurant.address} · livrare {restaurant.delivery_fee_mdl} MDL · minim{" "}
        {restaurant.min_order_amount_mdl} MDL
      </p>

      {!restaurant.accepting_orders && (
        <p className="mb-6 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900 dark:text-amber-300">
          Acest restaurant nu acceptă comenzi momentan.
        </p>
      )}

      {itemList.length === 0 ? (
        <p className="text-zinc-500">Niciun articol disponibil momentan.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {categoryList.map((category) => {
            const categoryItems = itemList.filter((item) => item.category_id === category.id);
            if (categoryItems.length === 0) return null;
            return (
              <section key={category.id}>
                <h2 className="mb-2 text-sm font-semibold uppercase text-zinc-500">{category.name}</h2>
                <ul className="flex flex-col gap-2">
                  {categoryItems.map((item) => (
                    <MenuItemRow key={item.id} item={item} restaurantId={restaurant.id} restaurantName={restaurant.name} />
                  ))}
                </ul>
              </section>
            );
          })}
          {uncategorized.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase text-zinc-500">Alte articole</h2>
              <ul className="flex flex-col gap-2">
                {uncategorized.map((item) => (
                  <MenuItemRow key={item.id} item={item} restaurantId={restaurant.id} restaurantName={restaurant.name} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function MenuItemRow({ item, restaurantId, restaurantName }: { item: MenuItem; restaurantId: string; restaurantName: string }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        {item.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.name} className="h-12 w-12 rounded-md object-cover" />
        )}
        <div>
          <p className="font-medium">{item.name}</p>
          {item.description && <p className="text-xs text-zinc-500">{item.description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-500">{item.price_mdl} MDL</span>
        <AddToCartButton restaurantId={restaurantId} restaurantName={restaurantName} item={item} />
      </div>
    </li>
  );
}
