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
import { chisinauNow, isOpenNow, nextOpeningLabel, type HoursRow } from "@/lib/orders/hours";
import { SITE_NAME, siteUrl } from "@/lib/seo/site";
import type { Metadata } from "next";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";

const CUISINE_RO: Record<string, string> = {
  sushi: "Sushi",
  fine_dining: "Fine dining",
  pizza: "Pizza",
  burgers: "Burgeri",
  asian: "Asiatic",
  other: "Restaurant",
};

// Audit de creștere 2026-08-15: fiecare pagină de restaurant purta titlul
// generic „Chișinău Delivery", fără descriere și fără imagine de partajare —
// un link trimis pe WhatsApp apărea gol, iar Google n-avea ce indexa. Titlul
// urmează intenția de căutare reală: „<Nume> — Sushi, livrare în Chișinău".
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("restaurants")
    .select("name, description, cuisine_type, cover_photo_url, sector")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return { title: `Restaurant negăsit · ${SITE_NAME}` };

  const cuisine = CUISINE_RO[data.cuisine_type] ?? "Restaurant";
  const title = `${data.name} — ${cuisine}, livrare în Chișinău`;
  const description =
    data.description?.trim() ||
    `Comandă de la ${data.name}${data.sector ? `, ${data.sector}` : ""} — ${cuisine.toLowerCase()} livrat acasă în Chișinău, cu urmărire live a comenzii.`;
  const url = `${siteUrl()}/restaurants/${slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "ro_MD",
      type: "website",
      ...(data.cover_photo_url ? { images: [{ url: data.cover_photo_url, alt: data.name }] } : {}),
    },
    twitter: {
      card: data.cover_photo_url ? "summary_large_image" : "summary",
      title,
      description,
      ...(data.cover_photo_url ? { images: [data.cover_photo_url] } : {}),
    },
  };
}

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
  const [groups, prepRows, popularHours, ratingBreakdown, hoursRows] = await Promise.all([
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
    supabase
      .from("restaurant_hours")
      .select("restaurant_id, day_of_week, opens_at, closes_at, is_closed")
      .eq("restaurant_id", typedRestaurant.id)
      .then(({ data }) => (data ?? []) as HoursRow[]),
  ]);
  // Audit 2026-08-11 HIGH: the menu page must know the closed state itself —
  // deep links skip the browse list, and place_order rejects at final submit.
  const { dow, time } = chisinauNow();
  const closedNow = !isOpenNow(hoursRows, dow, time);
  const nextOpening = closedNow ? nextOpeningLabel(hoursRows, dow, time) : null;
  const optionGroups: Record<string, MenuOptionGroup[]> = {};
  for (const g of (groups ?? []) as unknown as (MenuOptionGroup & { menu_options: MenuOptionGroup["options"] })[]) {
    const group: MenuOptionGroup = { ...g, options: (g.menu_options ?? []).filter((o) => o.is_available) };
    (optionGroups[g.menu_item_id] ??= []).push(group);
  }
  const prepEstimate = ((prepRows ?? []) as PrepEstimate[])[0];

  // Date structurate: fără ele Google vede o pagină oarecare, nu un restaurant
  // cu meniu și prețuri. Includem doar câmpuri pe care le avem cu adevărat —
  // un rating inventat sau un orar aproximativ ar fi dezinformare, nu SEO.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: typedRestaurant.name,
    ...(typedRestaurant.description ? { description: typedRestaurant.description } : {}),
    ...(typedRestaurant.cover_photo_url ? { image: typedRestaurant.cover_photo_url } : {}),
    url: `${siteUrl()}/restaurants/${slug}`,
    ...(typedRestaurant.phone ? { telephone: typedRestaurant.phone } : {}),
    address: {
      "@type": "PostalAddress",
      addressLocality: "Chișinău",
      addressCountry: "MD",
      ...(typedRestaurant.address ? { streetAddress: typedRestaurant.address } : {}),
    },
    ...(typedRestaurant.lat && typedRestaurant.lng
      ? { geo: { "@type": "GeoCoordinates", latitude: typedRestaurant.lat, longitude: typedRestaurant.lng } }
      : {}),
    ...(typedRestaurant.rating_count > 0 && typedRestaurant.rating_avg
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: typedRestaurant.rating_avg,
            reviewCount: typedRestaurant.rating_count,
          },
        }
      : {}),
    servesCuisine: CUISINE_RO[typedRestaurant.cuisine_type] ?? "Restaurant",
    priceRange: "$$",
    hasMenu: {
      "@type": "Menu",
      hasMenuSection: categories.map((c) => ({
        "@type": "MenuSection",
        name: c.name,
        hasMenuItem: items
          .filter((i) => i.category_id === c.id)
          .map((i) => ({
            "@type": "MenuItem",
            name: i.name,
            ...(i.description ? { description: i.description } : {}),
            offers: { "@type": "Offer", price: i.price_mdl, priceCurrency: "MDL" },
          })),
      })),
    },
  };

  return (
    <main className="relative isolate flex-1 px-5 pb-24 pt-6">
      {/* `ambient`: pagina are deja un erou — fotografia de copertă a localului.
          Atmosfera stă dedesubt ca să lege meniul de lumea din care ai intrat,
          fără să concureze cu mâncarea (§: „mâncarea e eroul"). */}
      <SectorBackdrop sector="customer" intensity="ambient" />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- JSON-LD generat de noi din date proprii
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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
      {typedRestaurant.accepting_orders && closedNow && (
        <p className="mt-4 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-400 ring-1 ring-amber-500/30">
          🕒 Închis acum{nextOpening ? ` — deschide ${nextOpening}` : ""}. Poți răsfoi meniul; comenzile se reiau în program.
        </p>
      )}

      <div className="mt-5">
        <MenuBrowser
          restaurant={typedRestaurant}
          categories={categories}
          items={items}
          optionGroups={optionGroups}
          closedNow={closedNow}
        />
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
