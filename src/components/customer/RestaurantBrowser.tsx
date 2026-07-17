"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PrepEstimate, Restaurant } from "@/lib/types/domain";
import { formatPrepRange } from "@/lib/orders/eta";

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

export function RestaurantBrowser({
  restaurants,
  estimates = {},
}: {
  restaurants: Restaurant[];
  estimates?: Record<string, PrepEstimate>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return restaurants.filter((r) => {
      if (category === "catering" && !r.accepts_catering) return false;
      if (category !== "all" && category !== "catering" && r.cuisine_type !== category) return false;
      if (q && !r.name.toLowerCase().includes(q) && !(r.description ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [restaurants, query, category]);

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
          placeholder="Caută restaurante sau preparate..."
          className="w-full bg-transparent text-[15px] text-white placeholder-white/40 outline-none"
        />
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${
              category === c.key
                ? "bg-primary text-white"
                : "bg-white/5 text-white/70 ring-1 ring-white/10 hover:bg-white/10"
            }`}
          >
            <span aria-hidden>{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-white">Restaurante alese</h2>
        <span className="text-sm text-white/40">{filtered.length} disponibile</span>
      </div>

      {/* Luxury horizontal cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <span className="text-4xl" aria-hidden>🔍</span>
          <p className="text-white/60">Niciun rezultat pentru căutarea ta.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((r) => (
            <Link
              key={r.id}
              href={`/restaurants/${r.slug}`}
              className="group relative overflow-hidden rounded-2xl p-5 ring-1 ring-gold/15 transition hover:ring-gold/40"
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
                    <span className="font-semibold text-gold">
                      {r.rating_count > 0 ? `★ ${Number(r.rating_avg).toFixed(1)} (${r.rating_count})` : "★ Nou"}
                    </span>
                    <span className="text-white/40">·</span>
                    <span className="text-white/70">
                      {formatPrepRange(estimates[r.id]?.prep_minutes ?? r.avg_prep_minutes)}
                    </span>
                  </p>
                  <span
                    className={`mt-3 inline-block rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                      Number(r.delivery_fee_mdl) === 0
                        ? "border-gold/60 text-gold"
                        : "border-white/25 text-white/70"
                    }`}
                  >
                    {Number(r.delivery_fee_mdl) === 0 ? "Livrare gratuită" : `Livrare ${r.delivery_fee_mdl} MDL`}
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
              {!r.accepting_orders && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <span className="rounded-full bg-white/95 px-4 py-1.5 text-sm font-semibold text-zinc-900">
                    Închis momentan
                  </span>
                </div>
              )}
            </Link>
          ))}

          {/* VIP catering banner — gold, maps to a real action */}
          <Link
            href="/catering"
            className="flex items-center justify-between gap-4 rounded-2xl border border-gold/40 bg-gradient-to-r from-[#2a1f0a] to-[#3d2c0e] p-5 transition hover:border-gold/70"
          >
            <div className="flex items-center gap-4">
              <span className="font-serif text-2xl font-bold text-gold">DA VIP</span>
              <div>
                <p className="font-semibold text-white">Dragons Catering pentru evenimente</p>
                <p className="text-sm text-white/50">Platouri premium, ofertă personalizată în aceeași zi</p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-gold px-4 py-2 text-xs font-bold uppercase tracking-wide text-zinc-900">
              Cere ofertă
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
