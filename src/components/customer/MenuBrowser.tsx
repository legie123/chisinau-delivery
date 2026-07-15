"use client";

import { useMemo, useState } from "react";
import { useCartStore } from "@/lib/orders/cart";
import type { MenuCategory, MenuItem, Restaurant } from "@/lib/types/domain";

export function MenuBrowser({
  restaurant,
  categories,
  items,
}: {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: MenuItem[];
}) {
  const addItem = useCartStore((s) => s.addItem);
  const lines = useCartStore((s) => s.lines);

  const visibleCategories = useMemo(() => {
    const withItems = categories.filter((c) => items.some((i) => i.category_id === c.id));
    const hasUncategorized = items.some((i) => !i.category_id);
    return [...withItems.map((c) => ({ id: c.id as string | null, name: c.name })), ...(hasUncategorized ? [{ id: null, name: "Altele" }] : [])];
  }, [categories, items]);

  const [selected, setSelected] = useState<string | null | "all">("all");

  const filtered = selected === "all" ? items : items.filter((i) => (i.category_id ?? null) === selected);

  const qtyInCart = (itemId: string) => lines.find((l) => l.menuItemId === itemId)?.quantity ?? 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Sticky category pills */}
      <div className="sticky top-[65px] z-30 -mx-5 bg-[#0a0a14]/95 px-5 py-3 backdrop-blur">
        <div className="flex gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setSelected("all")}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
              selected === "all" ? "bg-primary text-white" : "bg-white/5 text-white/70 ring-1 ring-white/10"
            }`}
          >
            Tot meniul
          </button>
          {visibleCategories.map((c) => (
            <button
              key={c.id ?? "none"}
              type="button"
              onClick={() => setSelected(c.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                selected === c.id ? "bg-primary text-white" : "bg-white/5 text-white/70 ring-1 ring-white/10"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-3 pb-24">
        {filtered.length === 0 && <p className="py-12 text-center text-white/50">Niciun articol în această categorie.</p>}
        {filtered.map((item) => {
          const inCart = qtyInCart(item.id);
          return (
            <div
              key={item.id}
              className="flex items-stretch justify-between gap-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06] transition hover:ring-white/15"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="font-semibold text-white">{item.name}</h3>
                {item.description && <p className="mt-1 line-clamp-2 text-sm text-white/50">{item.description}</p>}
                <div className="mt-auto flex items-center gap-3 pt-3">
                  <span className="text-[15px] font-bold text-primary">{item.price_mdl} MDL</span>
                  <button
                    type="button"
                    onClick={() => addItem(restaurant.id, restaurant.name, item)}
                    disabled={!restaurant.accepting_orders}
                    className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {inCart > 0 ? (
                      <>
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-xs font-bold">{inCart}</span>
                        Adaugă încă
                      </>
                    ) : (
                      <>Adaugă +</>
                    )}
                  </button>
                </div>
              </div>
              {item.photo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.photo_url} alt={item.name} className="h-24 w-24 shrink-0 rounded-xl object-cover sm:h-28 sm:w-28" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
