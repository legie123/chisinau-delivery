"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PrepEstimate, Restaurant } from "@/lib/types/domain";
import { formatPrepRange } from "@/lib/orders/eta";
import { useNearbyRestaurants } from "@/hooks/useNearbyRestaurants";
import { FavoriteButton } from "@/components/customer/FavoriteButton";
import type { MenuSearchHit } from "@/app/api/menu-search/route";

type SortKey = "recommended" | "distance" | "rating";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recommended", label: "Recomandate" },
  { key: "distance", label: "Distanță" },
  { key: "rating", label: "Rating" },
];

// WS3 — "480 m" / "1,4 km" (Romanian comma), snapped to 50 m under 1 km.
function distanceLabel(d: number | null): string | null {
  if (d == null) return null;
  if (d < 950) return `${Math.round(d / 50) * 50} m`;
  return `${(d / 1000).toFixed(1).replace(".", ",")} km`;
}

const CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: "all", label: "Toate", emoji: "🔥" },
  { key: "sushi", label: "Sushi", emoji: "🍣" },
  { key: "fine_dining", label: "Fine Dining", emoji: "🥂" },
  { key: "catering", label: "Catering", emoji: "🎉" },
];

// Luxury per-cuisine card tints — from the "Dragons Alliance Premium"
// reference: each restaurant card is a deep tinted gradient with gold accents.
const CARD_TINT: Record<string, string> = {
  sushi: "linear-gradient(105deg, #1a1023 0%, #3d1220 70%, #58152a 100%)",
  fine_dining: "linear-gradient(105deg, #171226 0%, #33250f 70%, #4a350f 100%)",
  other: "linear-gradient(105deg, #141426 0%, #1e2440 70%, #263056 100%)",
};

const CUISINE_LABEL: Record<string, string> = {
  sushi: "Sushi · Bucătărie japoneză",
  fine_dining: "Fine Dining",
  other: "Restaurant",
};

// Curated discovery strip — a compact, horizontally-scrolling rail of restaurant
// tiles above the main list, so the default view offers merchandising ("Cele mai
// apreciate", "Nou pe platformă") instead of one flat sortable list. Only shown
// on the unfiltered default view.
function DiscoveryStrip({ title, items }: { title: string; items: Restaurant[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h2 className="font-serif text-base font-semibold text-white/90">{title}</h2>
      <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {items.map((r) => (
          <Link
            key={r.id}
            href={`/restaurants/${r.slug}`}
            className="group relative flex w-44 shrink-0 flex-col justify-end overflow-hidden rounded-xl p-3.5 ring-1 ring-gold/15 transition hover:ring-gold/40"
            style={{ background: CARD_TINT[r.cuisine_type] ?? CARD_TINT.other, minHeight: "6.5rem" }}
          >
            {/* Audit design 2026-08-12 HIGH: the rails rendered tint-only cards
                next to a photo-rich list — the real cover now sits under the
                tint (darkened for text legibility), falling back to the tint
                alone when a restaurant has no photo. */}
            {r.cover_photo_url && (
              <img
                src={r.cover_photo_url}
                alt=""
                loading="lazy"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-45 transition group-hover:opacity-60"
              />
            )}
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" aria-hidden />
            <span className="pointer-events-none absolute -right-2 -top-3 select-none text-[56px] opacity-[0.07]" aria-hidden>
              🐉
            </span>
            <h3 className="relative font-serif text-sm font-bold leading-tight text-white transition line-clamp-2 group-hover:text-gold">
              {r.name}
            </h3>
            {/* Text tăiat pe cardurile de descoperire (2026-08-16): pe un card de
                11rem, „Sushi · Bucătărie japoneză" ieșea „Sushi · Bucătărie j…",
                iar nota se rupea în două rânduri („★" deasupra lui „5.0") fiindcă
                era lăsată să se strângă. Nota nu se mai strânge niciodată;
                bucătăria are voie la 2 rânduri (clamp explicit + titlu la hover),
                nu font mai mic — regula din rubrica de design §6. */}
            <p className="relative mt-1 flex items-start gap-1.5 text-xs">
              <span className="shrink-0 whitespace-nowrap font-semibold text-gold">
                {r.rating_count >= 3 ? `★ ${Number(r.rating_avg).toFixed(1)}` : "★ Nou"}
              </span>
              <span className="shrink-0 text-white/35">·</span>
              <span
                title={CUISINE_LABEL[r.cuisine_type] ?? r.cuisine_type}
                className="line-clamp-2 min-w-0 text-white/55"
              >
                {CUISINE_LABEL[r.cuisine_type] ?? r.cuisine_type}
              </span>
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function RestaurantBrowser({
  restaurants,
  estimates = {},
  favoriteIds = [],
  openNowIds = [],
  customerId = null,
}: {
  restaurants: Restaurant[];
  estimates?: Record<string, PrepEstimate>;
  favoriteIds?: string[];
  openNowIds?: string[];
  customerId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("recommended");
  // WS3 — soft geolocation reorders by proximity; fails open to the SSR list.
  const { restaurants: located, locating, located: hasLocation } = useNearbyRestaurants(restaurants);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const openNowSet = useMemo(() => new Set(openNowIds), [openNowIds]);

  // Bolt-Food-style mixed results: a query also surfaces dishes from
  // restaurants whose name doesn't match (e.g. "somon" finds Philadelphia
  // Roll at Sakura). Debounced + abortable so fast typing doesn't race.
  const [dishHits, setDishHits] = useState<MenuSearchHit[]>([]);
  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (q.length < 2) {
        setDishHits([]);
        return;
      }
      fetch(`/api/menu-search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { items: [] }))
        .then((data) => setDishHits(data.items ?? []))
        .catch(() => {
          /* aborted or offline — keep last known results */
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = located.filter((r) => {
      if (openNowOnly && !openNowSet.has(r.id)) return false;
      if (category === "catering" && !r.accepts_catering) return false;
      if (category !== "all" && category !== "catering" && r.cuisine_type !== category) return false;
      if (q && !r.name.toLowerCase().includes(q) && !(r.description ?? "").toLowerCase().includes(q)) return false;
      return true;
    });

    if (sort === "distance") {
      return [...list].sort((a, b) => {
        if (a.distance_m == null && b.distance_m == null) return 0;
        if (a.distance_m == null) return 1;
        if (b.distance_m == null) return -1;
        return a.distance_m - b.distance_m;
      });
    }
    if (sort === "rating") {
      return [...list].sort(
        (a, b) => Number(b.rating_avg ?? 0) - Number(a.rating_avg ?? 0) || b.rating_count - a.rating_count,
      );
    }
    return list; // "Recomandate" keeps the proximity/SSR order as-is.
  }, [located, query, category, openNowOnly, openNowSet, sort]);

  // Discovery rails (default view only): top-rated (needs >=3 reviews so a lone
  // 5-star doesn't lead) and newest by created_at. Derived from the full list,
  // independent of the active filter/sort.
  const topRated = useMemo(
    () =>
      restaurants
        .filter((r) => r.rating_count >= 3)
        .sort((a, b) => Number(b.rating_avg ?? 0) - Number(a.rating_avg ?? 0))
        .slice(0, 8),
    [restaurants],
  );
  const newest = useMemo(
    () =>
      [...restaurants]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 8),
    [restaurants],
  );
  const showDiscovery = query.trim() === "" && category === "all" && !openNowOnly;

  return (
    <div className="flex flex-col gap-5">
      {/* Search */}
      <div className="flex items-center gap-3 rounded-full bg-white/5 px-5 py-3.5 ring-1 ring-white/10 focus-within:ring-gold/50">
        <svg className="h-5 w-5 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Caută restaurante sau preparate"
          placeholder="Caută restaurante sau preparate..."
          className="w-full bg-transparent text-[15px] text-white placeholder-white/40 outline-none"
        />
      </div>

      {/* Dish search results — cross-restaurant, shown while the query matches items */}
      {dishHits.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-serif text-sm font-semibold uppercase tracking-wide text-white/50">
            Preparate găsite
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {dishHits.map((hit) => (
              <Link
                key={hit.item_id}
                href={`/restaurants/${hit.restaurant_slug}?item=${hit.item_id}`}
                className="flex w-56 shrink-0 flex-col gap-1 rounded-xl bg-white/5 p-3 ring-1 ring-white/10 transition hover:ring-gold/40"
              >
                <span className="truncate text-sm font-semibold text-white">{hit.item_name}</span>
                <span className="truncate text-xs text-white/50">{hit.restaurant_name}</span>
                <span className="text-sm font-semibold text-gold">{Number(hit.price_mdl)} MDL</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            aria-pressed={category === c.key}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${
              category === c.key
                ? "bg-primary-dark text-white"
                : "bg-white/5 text-white/70 ring-1 ring-white/10 hover:bg-white/10"
            }`}
          >
            <span aria-hidden>{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>

      {/* Open-now filter + sort control */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpenNowOnly((v) => !v)}
          aria-pressed={openNowOnly}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${
            openNowOnly
              ? "bg-gold text-zinc-900"
              : "bg-white/5 text-white/70 ring-1 ring-white/10 hover:bg-white/10"
          }`}
        >
          <span aria-hidden>🟢</span>
          Deschis acum
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* #4 — explicit sort agency: label + chevron, not a mystery toggle. */}
          <span className="flex items-center gap-1 text-xs font-medium text-white/50">
            Sortează
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </span>
          <div className="flex items-center gap-1 rounded-full bg-white/5 p-1 ring-1 ring-white/10">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  sort === s.key ? "bg-primary-dark text-white" : "text-white/60 hover:text-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showDiscovery && (
        <div className="flex flex-col gap-4">
          <DiscoveryStrip title="Cele mai apreciate" items={topRated} />
          <DiscoveryStrip title="Nou pe platformă" items={newest} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-white">
          {hasLocation ? "Aproape de tine" : "Restaurante alese"}
        </h2>
        <span className="text-sm text-white/40">
          {locating ? "Te localizăm…" : `${filtered.length} disponibile`}
        </span>
      </div>

      {/* Luxury horizontal cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <span className="text-4xl" aria-hidden>🔍</span>
          <p className="text-white/60">Niciun rezultat pentru căutarea ta.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((r) => {
            const isTop = Number(r.rating_avg) >= 4.7 && r.rating_count >= 10;
            // #2 — closed by manual toggle OR by today's hours.
            const isClosed = !r.accepting_orders || !openNowSet.has(r.id);
            const ratingTierColor =
              r.rating_count >= 3
                ? Number(r.rating_avg) >= 4.5
                  ? "#3fbf6b"
                  : Number(r.rating_avg) >= 4.0
                    ? "#f5a623"
                    : "rgba(255,255,255,0.4)"
                : null;
            return (
            <div key={r.id} className="relative">
            <Link
              href={`/restaurants/${r.slug}`}
              className="group relative block overflow-hidden rounded-2xl p-5 ring-1 ring-gold/15 transition hover:ring-gold/40"
              style={{ background: CARD_TINT[r.cuisine_type] ?? CARD_TINT.other }}
            >
              {/* dragon watermark */}
              <span className="pointer-events-none absolute -right-3 -top-5 select-none text-[90px] opacity-[0.07]" aria-hidden>
                🐉
              </span>
              <div className="relative flex items-center justify-between gap-5">
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif text-xl font-bold text-white transition group-hover:text-gold">
                    {r.name}
                  </h3>
                  <p className="mt-0.5 text-sm text-white/55">{CUISINE_LABEL[r.cuisine_type] ?? r.cuisine_type}</p>
                  <p className="mt-2 flex items-center gap-2 text-sm">
                    <span className="flex items-center gap-1.5 font-semibold text-gold">
                      {/* #1 — color-tier status dot lets the eye triage rating
                          quality across a dense grid faster than reading numbers. */}
                      {ratingTierColor && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ratingTierColor }}
                        />
                      )}
                      {/* #5 — a numeric rating from a single review reads as fake;
                          only show the score once it's backed by a few reviews. */}
                      {r.rating_count >= 3 ? `★ ${Number(r.rating_avg).toFixed(1)} (${r.rating_count})` : "★ Nou"}
                    </span>
                    <span className="text-white/40">·</span>
                    <span className="text-white/70">
                      {formatPrepRange(estimates[r.id] ?? r.avg_prep_minutes)}
                    </span>
                    {distanceLabel(r.distance_m) && (
                      <>
                        <span className="text-white/40">·</span>
                        <span className="font-medium text-gold/90">📍 {distanceLabel(r.distance_m)}</span>
                      </>
                    )}
                  </p>
                  <span className="mt-3 flex flex-wrap items-center gap-2">
                    {/* #2b — social-proof marker on top performers. */}
                    {isTop && (
                      <span className="inline-block rounded-md border border-gold/60 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-gold">
                        ★ Top
                      </span>
                    )}
                    <span
                      className={`inline-block rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                        Number(r.delivery_fee_mdl) === 0
                          ? "border-gold/60 text-gold"
                          : "border-white/25 text-white/70"
                      }`}
                    >
                      {Number(r.delivery_fee_mdl) === 0 ? "Livrare gratuită" : `Livrare ${r.delivery_fee_mdl} MDL`}
                    </span>
                    {/* #9 — surface the minimum order before the click, not at checkout.
                        #3 — always occupy the slot (invisible placeholder when min=0) so
                        the price/fee/min row keeps identical vertical rhythm on every card. */}
                    <span
                      aria-hidden={Number(r.min_order_amount_mdl) > 0 ? undefined : true}
                      className={`inline-block w-[92px] rounded-md border px-2.5 py-1 text-center text-[11px] font-medium ${
                        Number(r.min_order_amount_mdl) > 0
                          ? "border-white/15 text-white/50"
                          : "invisible border-transparent"
                      }`}
                    >
                      {Number(r.min_order_amount_mdl) > 0 ? `min. ${r.min_order_amount_mdl} MDL` : "min. 0 MDL"}
                    </span>
                  </span>
                </div>
                {r.cover_photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    loading="lazy"
                    decoding="async"
                    src={r.cover_photo_url}
                    alt={r.name}
                    className="h-28 w-28 shrink-0 rounded-xl object-cover shadow-lg shadow-black/40 sm:h-32 sm:w-40"
                  />
                )}
              </div>
              {/* #2 — closed by manual toggle OR by today's hours: visible before any
                  effort is spent, not only rejected at the final pay tap. */}
              {isClosed && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/70">
                  <span className="rounded-full bg-white/95 px-4 py-1.5 text-sm font-semibold text-zinc-900">
                    {!r.accepting_orders ? "Închis momentan" : "Închis acum"}
                  </span>
                </div>
              )}
            </Link>
            {/* #5b — closed is a recoverable moment, not a dead end. Sibling
                button OUTSIDE the <Link> so it triggers the filter, not navigation. */}
            {isClosed && (
              <button
                type="button"
                onClick={() => setOpenNowOnly(true)}
                className="absolute inset-x-0 bottom-5 z-10 mx-auto w-fit rounded-full bg-gold px-4 py-1.5 text-xs font-bold text-zinc-900 shadow-lg transition hover:bg-gold/90"
              >
                Vezi restaurante deschise
              </button>
            )}
            {customerId && (
              <FavoriteButton
                customerId={customerId}
                restaurantId={r.id}
                initialFavorited={favoriteSet.has(r.id)}
                className="absolute right-3 top-3 z-20"
              />
            )}
            </div>
            );
          })}

          {/* VIP catering banner — gold, maps to a real action. relative+overflow-hidden
              so the pg-shimmer sweep (first child, static under reduced-motion) stays
              clipped to the rounded card and never covers the text (it paints behind
              the later siblings in normal DOM/paint order). */}
          <Link
            href="/catering"
            className="relative flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-r from-[#2a1f0a] to-[#3d2c0e] p-5 transition hover:border-gold/70"
          >
            <span className="pg-shimmer pointer-events-none absolute inset-0" aria-hidden />
            <div className="relative flex items-center gap-4">
              <span className="font-serif text-2xl font-bold text-gold">DA VIP</span>
              <div>
                <p className="font-semibold text-white">Dragons Catering pentru evenimente</p>
                <p className="text-sm text-white/50">Platouri premium, ofertă personalizată în aceeași zi</p>
              </div>
            </div>
            <span className="relative shrink-0 rounded-full bg-gold px-4 py-2 text-xs font-bold uppercase tracking-wide text-zinc-900">
              Cere ofertă
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
