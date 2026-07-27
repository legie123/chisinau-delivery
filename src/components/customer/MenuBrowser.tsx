"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cartLineId, useCartStore } from "@/lib/orders/cart";
import type { MenuCategory, MenuItem, MenuOptionGroup, Restaurant } from "@/lib/types/domain";
import { ItemModifierModal } from "@/components/customer/ItemModifierModal";

// Sticky header (top-0) + sticky pill bar (top-[65px] below it) — sections need
// enough scroll-margin so scrollIntoView()/anchor jumps don't land underneath them.
const SECTION_SCROLL_MARGIN = 140;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function MenuBrowser({
  restaurant,
  categories,
  items,
  optionGroups = {},
}: {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: MenuItem[];
  optionGroups?: Record<string, MenuOptionGroup[]>;
}) {
  const addItem = useCartStore((s) => s.addItem);
  const setQuantity = useCartStore((s) => s.setQuantity);
  // item currently being customized in the modifier modal (has option groups)
  const [customizing, setCustomizing] = useState<MenuItem | null>(null);
  const lines = useCartStore((s) => s.lines);
  const cartRestaurantId = useCartStore((s) => s.restaurantId);
  const cartRestaurantName = useCartStore((s) => s.restaurantName);
  const pendingSwitch = useCartStore((s) => s.pendingSwitch);
  const confirmSwitch = useCartStore((s) => s.confirmSwitch);
  const cancelSwitch = useCartStore((s) => s.cancelSwitch);

  // Continuous menu (DoorDash/NNG pattern): every category renders as its own
  // section, one scroll, no filtering. Pills are a map of the assortment —
  // clicking one scrolls to the section; scrollspy below keeps the active pill
  // in sync with what's actually in view. A synthetic "Populare" section is
  // pinned first, seeded from the partner-controlled sort_order (moveMenuItem) —
  // top sellers surface above the taxonomy without restructuring it.
  const sections = useMemo(() => {
    const withItems = categories.filter((c) => items.some((i) => i.category_id === c.id));
    const hasUncategorized = items.some((i) => !i.category_id);
    const real = [
      ...withItems.map((c) => ({ id: c.id as string, name: c.name, items: items.filter((i) => i.category_id === c.id) })),
      ...(hasUncategorized ? [{ id: "none", name: "Altele", items: items.filter((i) => !i.category_id) }] : []),
    ];
    const popular = [...items].sort((a, b) => a.sort_order - b.sort_order).slice(0, Math.min(4, items.length));
    return popular.length > 0 ? [{ id: "popular", name: "Populare", items: popular }, ...real] : real;
  }, [categories, items]);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  // categories/items are stable server-fetched props, so the first section is a
  // safe lazy-init default; scrollspy below takes over from there.
  const [activeId, setActiveId] = useState<string>(() => sections[0]?.id ?? "");

  useEffect(() => {
    const ids = sections.map((s) => s.id);
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const id = top.target.getAttribute("data-section-id");
        if (id) setActiveId(id);
      },
      { rootMargin: `-${SECTION_SCROLL_MARGIN}px 0px -65% 0px`, threshold: [0, 1] },
    );
    for (const id of ids) {
      const el = sectionRefs.current[id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  function scrollToSection(id: string) {
    sectionRefs.current[id]?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  // #12 — a dish-search result deep-links here with ?item=<id>: scroll to it and
  // briefly highlight it. Items can now render twice (Populare + real category),
  // so we look up by data-item-id (querySelector, first match) instead of a
  // (necessarily unique) DOM id.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("item");
    if (!target) return;
    const safe = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(target) : target;
    const el = document.querySelector<HTMLElement>(`[data-item-id="${safe}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightId(target);
    const t = setTimeout(() => setHighlightId(null), 2400);
    return () => clearTimeout(t);
  }, []);

  // An item can now sit in the cart as several option-lines — sum them.
  const qtyInCart = (itemId: string) =>
    lines.filter((l) => l.menuItemId === itemId).reduce((s, l) => s + l.quantity, 0);
  const groupsFor = (itemId: string) => optionGroups[itemId] ?? [];

  // Non-modal "Adăugat în coș" toast — the quick-add "+" otherwise gives no
  // feedback that anything happened. Auto-dismisses; static under reduced motion.
  const [toastOpen, setToastOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast() {
    setToastOpen(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastOpen(false), 2000);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function willSwitchRestaurant() {
    return cartRestaurantId !== null && cartRestaurantId !== restaurant.id && lines.length > 0;
  }

  // Add: if the item has option groups, open the modifier modal; else add directly.
  function handleAdd(item: MenuItem) {
    if (groupsFor(item.id).length > 0) {
      setCustomizing(item);
      return;
    }
    const switching = willSwitchRestaurant();
    addItem(restaurant.id, restaurant.name, item);
    if (!switching) showToast();
  }

  // First photo in DOM order (Populare, if present, comes first) keeps LCP
  // eager/high-priority; every other occurrence — including a repeat of the
  // same item further down — stays lazy.
  let eagerKey: string | null = null;
  for (const s of sections) {
    const found = s.items.find((i) => i.photo_url);
    if (found) {
      eagerKey = `${s.id}:${found.id}`;
      break;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* #38 — cross-restaurant add no longer silently wipes the cart; confirm inline. */}
      {pendingSwitch && pendingSwitch.restaurantId === restaurant.id && (
        <div className="flex flex-col gap-3 rounded-2xl bg-primary/10 p-4 ring-1 ring-primary/30">
          <p className="text-sm text-white/80">
            Coșul conține produse de la {cartRestaurantName}. Îl golești și începi o comandă nouă aici?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmSwitch}
              className="rounded-full bg-primary-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-darker"
            >
              Golește și adaugă
            </button>
            <button
              type="button"
              onClick={cancelSwitch}
              className="rounded-full bg-white/5 px-4 py-2 text-sm text-white/70 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              Renunță
            </button>
          </div>
        </div>
      )}

      {/* Sticky category pills — a map of the assortment, not a filter. */}
      <div className="sticky top-[65px] z-30 -mx-5 bg-[#0a0a14]/95 px-5 py-3 backdrop-blur">
        <div className="flex gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                activeId === section.id ? "bg-primary-dark text-white" : "bg-white/5 text-white/70 ring-1 ring-white/10"
              }`}
            >
              {section.name}
            </button>
          ))}
        </div>
      </div>

      {/* Continuous menu: one scroll, every category a titled section. */}
      <div className="flex flex-col gap-8 pb-24">
        {items.length === 0 && <p className="py-12 text-center text-white/50">Meniul este gol momentan.</p>}
        {sections.map((section) => (
          <section
            key={section.id}
            data-section-id={section.id}
            style={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}
            ref={(el) => {
              sectionRefs.current[section.id] = el;
            }}
          >
            <h2
              className={`mb-3 font-serif text-lg font-bold sm:text-xl ${
                section.id === "popular" ? "text-gold" : "text-white"
              }`}
            >
              {section.name}
            </h2>
            <div className="flex flex-col gap-3">
              {section.items.map((item) => {
                const inCart = qtyInCart(item.id);
                const hasGroups = groupsFor(item.id).length > 0;
                const isEager = eagerKey === `${section.id}:${item.id}`;
                return (
                  <div
                    key={`${section.id}:${item.id}`}
                    data-item-id={item.id}
                    id={`item-${section.id}-${item.id}`}
                    className={`flex items-stretch justify-between gap-4 rounded-2xl bg-white/[0.04] p-4 ring-1 transition ${
                      highlightId === item.id ? "ring-2 ring-gold" : "ring-white/[0.06] hover:ring-white/15"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <h3 className="font-semibold text-white">{item.name}</h3>
                      {item.description && <p className="mt-1 line-clamp-2 text-sm text-white/50">{item.description}</p>}
                      <div className="mt-auto flex items-center gap-3 pt-3">
                        <span className="text-[15px] font-bold text-primary">{item.price_mdl} MDL</span>
                        {/* Modifier items keep the in-row text button — its presence
                            IS the required-modifier signal. Zero-modifier items move
                            the affordance onto the photo (see below). */}
                        {hasGroups && (
                          <button
                            type="button"
                            onClick={() => handleAdd(item)}
                            disabled={!restaurant.accepting_orders}
                            className="flex items-center gap-1.5 rounded-full bg-primary-dark px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {inCart > 0 ? (
                              <>
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-xs font-bold">{inCart}</span>
                                Adaugă încă
                              </>
                            ) : (
                              <>Alege +</>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    {item.photo_url ? (
                      <div className="relative h-24 w-24 shrink-0 sm:h-28 sm:w-28">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          loading={isEager ? "eager" : "lazy"}
                          fetchPriority={isEager ? "high" : "low"}
                          decoding="async"
                          src={item.photo_url}
                          alt={item.name}
                          className="h-full w-full rounded-xl object-cover"
                        />
                        {!hasGroups && (
                          <button
                            type="button"
                            onClick={() => handleAdd(item)}
                            disabled={!restaurant.accepting_orders}
                            aria-label={`Adaugă ${item.name} în coș`}
                            className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary-dark text-lg font-bold leading-none text-white shadow-lg ring-2 ring-[#0a0a14] transition hover:bg-primary-darker disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            +
                          </button>
                        )}
                        {!hasGroups && inCart > 0 && (
                          <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-[11px] font-bold text-black">
                            {inCart}
                          </span>
                        )}
                      </div>
                    ) : (
                      !hasGroups && (
                        <button
                          type="button"
                          onClick={() => handleAdd(item)}
                          disabled={!restaurant.accepting_orders}
                          className="flex shrink-0 items-center gap-1.5 self-end rounded-full bg-primary-dark px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {inCart > 0 ? `Adaugă încă (${inCart})` : "Adaugă +"}
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {customizing && (
        <ItemModifierModal
          item={customizing}
          groups={groupsFor(customizing.id)}
          onClose={() => setCustomizing(null)}
          onAdd={(options, qty) => {
            const switching = willSwitchRestaurant();
            addItem(restaurant.id, restaurant.name, customizing, options);
            if (!switching && qty > 1) setQuantity(cartLineId(customizing.id, options.optionIds), qty);
            setCustomizing(null);
            if (!switching) showToast();
          }}
        />
      )}

      {/* Bottom-center non-modal toast — static under reduced motion. */}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-6 transition-all duration-300 motion-reduce:transition-none ${
          toastOpen ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <span className="rounded-full bg-[#14141f] px-5 py-2.5 text-sm font-medium text-white shadow-xl ring-1 ring-gold/30">
          Adăugat în coș
        </span>
      </div>
    </div>
  );
}
