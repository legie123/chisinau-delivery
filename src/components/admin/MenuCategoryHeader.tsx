"use client";

import { useState, useTransition } from "react";
import { moveCategory } from "@/app/(admin)/restaurant/menu/actions";

// Category ↑/↓ reorder header — mirrors MenuItemRow's item-reorder pattern
// (no isFirst/isLast gating; the server action is a safe no-op at either edge).
export function MenuCategoryHeader({ categoryId, name }: { categoryId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleMove(direction: "up" | "down") {
    setError(null);
    startTransition(async () => {
      const result = await moveCategory(categoryId, direction);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="mb-2 flex items-center gap-2">
      <h2 className="text-sm font-semibold uppercase text-white/50">{name}</h2>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => handleMove("up")}
          disabled={pending}
          aria-label={`Mută categoria ${name} mai sus`}
          className="flex h-5 w-5 items-center justify-center rounded text-xs text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => handleMove("down")}
          disabled={pending}
          aria-label={`Mută categoria ${name} mai jos`}
          className="flex h-5 w-5 items-center justify-center rounded text-xs text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          ↓
        </button>
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
