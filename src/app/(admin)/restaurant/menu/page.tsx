import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AddCategoryForm } from "@/components/admin/AddCategoryForm";
import { AddMenuItemForm } from "@/components/admin/AddMenuItemForm";
import { MenuCategoryHeader } from "@/components/admin/MenuCategoryHeader";
import { MenuItemRow } from "@/components/admin/MenuItemRow";
import { PremiumReveal } from "@/components/admin/premium/PremiumReveal";
import type { MenuCategory, MenuItem, MenuOptionGroup } from "@/lib/types/domain";

export default async function RestaurantMenuPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Multi-restaurant partner guard: .maybeSingle() throws on 2+ rows — take the
  // primary (oldest) link so the page never 500s.
  const { data: staffRows } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id, restaurants(name)")
    .eq("user_id", user?.id ?? "")
    .order("created_at", { ascending: true })
    .limit(1);
  const staffRow = staffRows?.[0] ?? null;

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

  // Menu modifiers: option groups + options for this restaurant's items → itemId map.
  const groupsByItem: Record<string, MenuOptionGroup[]> = {};
  if (itemList.length > 0) {
    const { data: groups } = await supabase
      .from("menu_option_groups")
      .select("*, menu_options(*)")
      .in("menu_item_id", itemList.map((i) => i.id))
      .order("sort_order")
      .order("sort_order", { referencedTable: "menu_options" });
    for (const g of (groups ?? []) as unknown as (MenuOptionGroup & { menu_options: MenuOptionGroup["options"] })[]) {
      (groupsByItem[g.menu_item_id] ??= []).push({ ...g, options: g.menu_options ?? [] });
    }
  }

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 font-serif text-2xl font-semibold">
        Meniul meu{restaurantName ? <> — <span className="pg-gold-text">{restaurantName}</span></> : ""}
      </h1>

      <Link
        href="/restaurant/menu/import"
        className="mb-6 inline-flex min-h-11 items-center rounded-full bg-white/5 px-4 text-sm text-white/75 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        ⇪ Import din Excel / Google Sheets
      </Link>
      <Link
        href="/restaurant/menu/prices"
        className="mb-6 ml-2 inline-flex min-h-11 items-center rounded-full bg-white/5 px-4 text-sm text-white/75 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        % Prețuri în masă
      </Link>
      <AddCategoryForm />
      <AddMenuItemForm restaurantId={restaurantId} categories={categoryList} />

      {itemList.length === 0 ? (
        <p className="text-white/50">Niciun articol de meniu încă.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {categoryList.length > 1 && (
            <p className="text-xs text-white/40">
              Recomandat: promoții → populare → aperitive → feluri principale → garnituri → desert/băuturi.
            </p>
          )}
          {categoryList.map((category, i) => {
            const categoryItems = itemList.filter((item) => item.category_id === category.id);
            if (categoryItems.length === 0) return null;
            return (
              <PremiumReveal key={category.id} as="section" delay={i * 50}>
                <MenuCategoryHeader categoryId={category.id} name={category.name} />
                <ul className="flex flex-col gap-2">
                  {categoryItems.map((item) => (
                    <MenuItemRow key={item.id} item={item} optionGroups={groupsByItem[item.id] ?? []} />
                  ))}
                </ul>
              </PremiumReveal>
            );
          })}
          {uncategorized.length > 0 && (
            <PremiumReveal as="section" delay={categoryList.length * 50}>
              <h2 className="mb-2 text-sm font-semibold uppercase text-white/50">Fără categorie</h2>
              <ul className="flex flex-col gap-2">
                {uncategorized.map((item) => (
                  <MenuItemRow key={item.id} item={item} optionGroups={groupsByItem[item.id] ?? []} />
                ))}
              </ul>
            </PremiumReveal>
          )}
        </div>
      )}
    </main>
  );
}
