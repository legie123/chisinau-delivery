"use client";

import { useState } from "react";

// Heart toggle on a restaurant card. Cards are <Link>s, so every click
// stopPropagation + preventDefault to keep the tap from navigating. Optimistic:
// flip locally first, roll back only if the direct favorites write fails.
// RLS (favorites_self) scopes rows to auth.uid(); we still pass customer_id
// explicitly since the column has no default.
export function FavoriteButton({
  customerId,
  restaurantId,
  initialFavorited,
  className = "",
}: {
  customerId: string;
  restaurantId: string;
  initialFavorited: boolean;
  className?: string;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, setPending] = useState(false);

  async function toggle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;

    const next = !favorited;
    setFavorited(next); // optimistic
    setPending(true);
    try {
      // Lazy: only a tap needs supabase-js, not the restaurant list's first paint.
      // The chunk load can fail on a weak connection — that rolls back like a write error.
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const { error } = next
        ? await supabase.from("favorites").insert({ customer_id: customerId, restaurant_id: restaurantId })
        : await supabase.from("favorites").delete().eq("customer_id", customerId).eq("restaurant_id", restaurantId);

      if (error) setFavorited(!next); // roll back on failure
    } catch {
      setFavorited(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={favorited}
      aria-label={favorited ? "Elimină din favorite" : "Adaugă la favorite"}
      // Ținta măsurată era 36×36 pe toate cardurile. Butonul are ACUM 44×44, iar
      // cercul desenat rămâne 36 (mărirea lui ar mânca din fotografie) — cutia
      // crește, aspectul nu. Prima variantă a fost o zonă invizibilă `::after`,
      // trucul obișnuit; l-am aruncat fiindcă hit-testul a arătat că nu ține:
      // la 2px deasupra inimii `elementFromPoint` întorcea tot linkul cardului,
      // deci butonul era mărit doar pe hârtie.
      className={`flex h-11 w-11 items-center justify-center ${className}`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 ring-1 ring-white/15 backdrop-blur transition hover:bg-black/60 active:scale-90">
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`h-[18px] w-[18px] transition ${favorited ? "scale-110 text-gold" : "text-white/70"}`}
          fill={favorited ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21s-7.5-4.35-10-9.5C.5 8 2.5 4.5 6 4.5c2 0 3.3 1.1 4 2.3.7-1.2 2-2.3 4-2.3 3.5 0 5.5 3.5 4 7-2.5 5.15-10 9.5-10 9.5z"
          />
        </svg>
      </span>
    </button>
  );
}
