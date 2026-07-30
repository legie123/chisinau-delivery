import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPrepEstimates, getPopularHours, getRatingBreakdown } from "@chisinau/shared-api";
import { CoverImage } from "@/components/customer/CoverImage";
import { MenuBrowser } from "@/components/customer/MenuBrowser";
import { RestaurantInsights } from "@/components/customer/RestaurantInsights";
import type {
  MenuCategory,
  MenuItem,
  MenuOptionGroup,
  PopularHourRow,
  PrepEstimate,
  RatingBreakdownRow,
  Restaurant,
} from "@/lib/types/domain";
import { formatPrepRange } from "@/lib/orders/eta";

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

  // Everything below only needs stage-1 results (restaurant id + item ids), so it
  // all runs in ONE parallel network stage — the menu page went from 4 serial
  // roundtrips to 2. Modifiers → itemId map; WS4 prep estimate (falls back to the
  // static column); premium histograms (anon-reachable, aggregate-only, both
  // soft-fail to [] on any hiccup — see shared-api/discovery.ts).
  const itemIds = items.map((i) => i.id);
  const [groups, prepRows, popularHours, ratingBreakdown] = await Promise.all([
    itemIds.length > 0
      ? supabase
          .from("menu_option_groups")
          .select("*, menu_options(*)")
          .in("menu_item_id", itemIds)
          .order("sort_order")
          .order("sort_order", { referencedTable: "menu_options" })
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
    getPrepEstimates(supabase, [typedRestaurant.id]),
    getPopularHours(supabase, typedRestaurant.id),
    getRatingBreakdown(supabase, typedRestaurant.id),
  ]);
  const optionGroups: Record<string, MenuOptionGroup[]> = {};
  for (const g of (groups ?? []) as unknown as (MenuOptionGroup & { menu_options: MenuOptionGroup["options"] })[]) {
    const group: MenuOptionGroup = { ...g, options: (g.menu_options ?? []).filter((o) => o.is_available) };
    (optionGroups[g.menu_item_id] ??= []).push(group);
  }
  const prepEstimate = ((prepRows ?? []) as PrepEstimate[])[0];

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
        {/* Faceted dragon-scale texture — CSS gradient only, no image asset,
            painted after the darkening gradient so it reads as a subtle
            crystalline weave over the photo without touching the LCP <img>. */}
        <div className="pg-hero-facet" aria-hidden />
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{typedRestaurant.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
            <span className="flex items-center gap-1 rounded-full bg-[#fdf6e3] px-2 py-0.5 text-xs font-bold text-zinc-900">
              <span className="text-gold" aria-hidden>★</span>{" "}
              {typedRestaurant.rating_count > 0
                ? `${Number(typedRestaurant.rating_avg).toFixed(1)} (${typedRestaurant.rating_count})`
                : "Nou"}
            </span>
            <span>{formatPrepRange(prepEstimate ?? typedRestaurant.avg_prep_minutes)}</span>
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
        <MenuBrowser restaurant={typedRestaurant} categories={categories} items={items} optionGroups={optionGroups} />
      </div>

      {/* Discreet info section — deliberately below the menu, never above it. */}
      <RestaurantInsights
        popularHours={(popularHours ?? []) as PopularHourRow[]}
        ratingBreakdown={(ratingBreakdown ?? []) as RatingBreakdownRow[]}
        ratingAvg={Number(typedRestaurant.rating_avg)}
        ratingCount={typedRestaurant.rating_count}
      />
    </main>
  );
}
