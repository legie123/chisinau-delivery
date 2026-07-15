import { createClient } from "@/lib/supabase/server";
import { AddCategoryForm } from "@/components/admin/AddCategoryForm";
import { AddMenuItemForm } from "@/components/admin/AddMenuItemForm";
import { MenuItemRow } from "@/components/admin/MenuItemRow";
import type { MenuCategory, MenuItem } from "@/lib/types/domain";

export default async function RestaurantMenuPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: staffRow } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id, restaurants(name)")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  if (!staffRow) {
    return (
      <main className="flex-1 px-6 py-10">
        <h1 className="mb-2 text-2xl font-semibold">Meniul meu</h1>
        <p className="text-white/50">
          Contul tău nu este încă asociat cu un restaurant. Contactează un administrator.
        </p>
      </main>
    );
  }

  const restaurantId = staffRow.restaurant_id as string;
  const restaurantName = (staffRow.restaurants as unknown as { name: string }[] | null)?.[0]?.name;

  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase.from("menu_categories").select("*").eq("restaurant_id", restaurantId).order("sort_order"),
    supabase.from("menu_items").select("*").eq("restaurant_id", restaurantId).order("sort_order"),
  ]);

  const categoryList = (categories ?? []) as MenuCategory[];
  const itemList = (items ?? []) as MenuItem[];
  const uncategorized = itemList.filter((item) => !item.category_id);

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Meniul meu{restaurantName ? ` — ${restaurantName}` : ""}</h1>

      <AddCategoryForm />
      <AddMenuItemForm restaurantId={restaurantId} categories={categoryList} />

      {itemList.length === 0 ? (
        <p className="text-white/50">Niciun articol de meniu încă.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {categoryList.map((category) => {
            const categoryItems = itemList.filter((item) => item.category_id === category.id);
            if (categoryItems.length === 0) return null;
            return (
              <section key={category.id}>
                <h2 className="mb-2 text-sm font-semibold uppercase text-white/50">{category.name}</h2>
                <ul className="flex flex-col gap-2">
                  {categoryItems.map((item) => (
                    <MenuItemRow key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            );
          })}
          {uncategorized.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase text-white/50">Fără categorie</h2>
              <ul className="flex flex-col gap-2">
                {uncategorized.map((item) => (
                  <MenuItemRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
