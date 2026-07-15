"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CoverImage } from "./CoverImage";
import type { Restaurant } from "@/lib/types/domain";

const CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: "all", label: "Toate", emoji: "🔥" },
  { key: "sushi", label: "Sushi", emoji: "🍣" },
  { key: "fine_dining", label: "Fine Dining", emoji: "🥂" },
  { key: "catering", label: "Catering", emoji: "🎉" },
];

export function RestaurantBrowser({ restaurants }: { restaurants: Restaurant[] }) {
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
      {/* Search — Bolt-style big rounded input */}
      <div className="flex items-center gap-3 rounded-full bg-white/5 px-5 py-3.5 ring-1 ring-white/10 focus-within:ring-primary/60">
        <svg className="h-5 w-5 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Caută restaurante, sushi, feluri..."
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

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <span className="text-4xl" aria-hidden>🔍</span>
          <p className="text-white/60">Niciun rezultat pentru căutarea ta.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {filtered.map((r) => (
            <Link key={r.id} href={`/restaurants/${r.slug}`} className="group">
              <CoverImage src={r.cover_photo_url} cuisine={r.cuisine_type} alt={r.name}>
                {/* fee badge — top-left, Bolt discount-badge position */}
                <span className="absolute left-3 top-3 rounded-lg bg-primary px-2.5 py-1 text-xs font-bold text-white">
                  {Number(r.delivery_fee_mdl) === 0 ? "Livrare gratuită" : `Livrare ${r.delivery_fee_mdl} MDL`}
                </span>
                {/* rating pill — bottom-right */}
                <span className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-[#fdf6e3] px-2.5 py-1 text-xs font-bold text-zinc-900">
                  <span className="text-gold" aria-hidden>★</span> Nou
                </span>
                {!r.accepting_orders && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/65">
                    <span className="rounded-full bg-white/95 px-4 py-1.5 text-sm font-semibold text-zinc-900">
                      Închis momentan
                    </span>
                  </div>
                )}
              </CoverImage>
              <div className="mt-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-[17px] font-semibold text-white transition group-hover:text-primary">
                    {r.name}
                  </h2>
                  <p className="mt-0.5 line-clamp-1 text-sm text-white/50">{r.description ?? r.address}</p>
                </div>
              </div>
              <p className="mt-1.5 flex items-center gap-3 text-[13px] text-white/60">
                <span className="flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" d="M12 7v5l3 2" />
                  </svg>
                  {r.avg_prep_minutes}–{r.avg_prep_minutes + 15} min
                </span>
                <span>·</span>
                <span>minim {r.min_order_amount_mdl} MDL</span>
                {r.accepts_catering && (
                  <>
                    <span>·</span>
                    <span className="text-gold">Catering</span>
                  </>
                )}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
