"use client";

import { useState, useTransition } from "react";
import { deleteMenuItem, toggleItemAvailability } from "@/app/(admin)/restaurant/menu/actions";
import type { MenuItem } from "@/lib/types/domain";

export function MenuItemRow({ item }: { item: MenuItem }) {
  const [isAvailable, setIsAvailable] = useState(item.is_available);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const next = !isAvailable;
    setIsAvailable(next);
    startTransition(async () => {
      try {
        await toggleItemAvailability(item.id, next);
      } catch {
        setIsAvailable(!next);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteMenuItem({ error: null }, (() => {
        const fd = new FormData();
        fd.set("item_id", item.id);
        return fd;
      })());
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        {item.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.name} className="h-12 w-12 rounded-md object-cover" />
        )}
        <div>
          <p className="font-medium">
            {item.name} {item.is_catering_only && <span className="text-xs text-amber-600">(catering)</span>}
          </p>
          {item.description && <p className="text-xs text-zinc-500">{item.description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-500">{item.price_mdl} MDL</span>
        <button
          type="button"
          onClick={handleToggle}
          disabled={pending}
          className={`rounded-full px-3 py-1 text-xs ${
            isAvailable
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
              : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {isAvailable ? "Disponibil" : "Indisponibil"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="text-xs text-red-600 underline underline-offset-4"
        >
          Șterge
        </button>
      </div>
    </li>
  );
}
