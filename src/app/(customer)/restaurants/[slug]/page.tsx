import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CoverImage } from "@/components/customer/CoverImage";
import { MenuBrowser } from "@/components/customer/MenuBrowser";
import type { MenuCategory, MenuItem, Restaurant } from "@/lib/types/domain";

export default async function RestaurantMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  // One PostgREST call via embedded resources instead of 2 sequential trips —
  // this is the hottest customer path.
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*, menu_categories(*), menu_items(*)")
    .eq("slug", slug)
    .eq("is_active", true)
    .eq("menu_items.is_available", true)
    .eq("menu_items.is_catering_only", false)
    .order("sort_order", { referencedTable: "menu_categories" })
    .order("sort_order", { referencedTable: "menu_items" })
    .single();

  if (!restaurant) notFound();

  const typedRestaurant = restaurant as Restaurant & { menu_categories: MenuCategory[]; menu_items: MenuItem[] };
  const categories = typedRestaurant.menu_categories;
  const items = typedRestaurant.menu_items;

  return (
    <main className="flex-1 px-5 pb-24 pt-6">
      {/* Cover banner with overlaid identity — Bolt restaurant header */}
      <CoverImage
        src={typedRestaurant.cover_photo_url}
        cuisine={typedRestaurant.cuisine_type}
        alt={typedRestaurant.name}
        heightClass="h-52 sm:h-64"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{typedRestaurant.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
            <span className="flex items-center gap-1 rounded-full bg-[#fdf6e3] px-2 py-0.5 text-xs font-bold text-zinc-900">
              <span className="text-gold" aria-hidden>★</span> Nou
            </span>
            <span>
              {typedRestaurant.avg_prep_minutes}–{typedRestaurant.avg_prep_minutes + 15} min
            </span>
            <span>·</span>
            <span>
              {Number(typedRestaurant.delivery_fee_mdl) === 0
                ? "Livrare gratuită"
                : `Livrare ${typedRestaurant.delivery_fee_mdl} MDL`}
            </span>
            <span>·</span>
            <span>minim {typedRestaurant.min_order_amount_mdl} MDL</span>
          </p>
        </div>
      </CoverImage>

      {!typedRestaurant.accepting_orders && (
        <p className="mt-4 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-400 ring-1 ring-amber-500/30">
          Acest restaurant nu acceptă comenzi momentan — poți răsfoi meniul.
        </p>
      )}

      <div className="mt-5">
        <MenuBrowser restaurant={typedRestaurant} categories={categories} items={items} />
      </div>
    </main>
  );
}
