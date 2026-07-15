"use client";

import { useState, useTransition } from "react";
import { deleteMenuItem, toggleItemAvailability } from "@/app/(admin)/restaurant/menu/actions";
import type { MenuItem } from "@/lib/types/domain";

export function MenuItemRow({ item }: { item: MenuItem }) {
  const [isAvailable, setIsAvailable] = useState(item.is_available);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Re-sync availability when the server component re-renders with fresh data
  // (adjust-during-render, same pattern as useOrderRealtime).
  const [prevAvailable, setPrevAvailable] = useState(item.is_available);
  if (prevAvailable !== item.is_available) {
    setPrevAvailable(item.is_available);
    setIsAvailable(item.is_available);
  }

  function handleToggle() {
    const next = !isAvailable;
    setIsAvailable(next);
    setError(null);
    startTransition(async () => {
      const result = await toggleItemAvailability(item.id, next);
      if (result.error) {
        setIsAvailable(!next);
        setError("Nu am putut schimba disponibilitatea.");
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("item_id", item.id);
      const result = await deleteMenuItem({ error: null }, fd);
      setConfirmingDelete(false);
      if (result.error) {
        // FK from order_items blocks deleting anything ever ordered.
        setError(
          result.error.includes("foreign key") || result.error.includes("violates")
            ? "Articolul are comenzi în istoric și nu poate fi șters — marchează-l indisponibil."
            : "Ștergerea a eșuat.",
        );
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/[0.06]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {item.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img loading="lazy" decoding="async" src={item.photo_url} alt={item.name} className="h-12 w-12 rounded-md object-cover" />
          )}
          <div>
            <p className="font-medium">
              {item.name} {item.is_catering_only && <span className="text-xs text-amber-400">(catering)</span>}
            </p>
            {item.description && <p className="text-xs text-white/50">{item.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-white/50">{item.price_mdl} MDL</span>
          <button
            type="button"
            onClick={handleToggle}
            disabled={pending}
            className={`rounded-full px-3 py-1 text-xs ${
              isAvailable ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" : "bg-white/10 text-white/50"
            }`}
          >
            {isAvailable ? "Disponibil" : "Indisponibil"}
          </button>
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                Confirmă
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-xs text-white/50 underline underline-offset-4"
              >
                Anulează
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              className="text-xs text-red-400 underline underline-offset-4"
            >
              Șterge
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </li>
  );
}
