"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cartLineId, cartSubtotal, useCartStore, type CartLine } from "@/lib/orders/cart";
import { useHydrated } from "@/hooks/useHydrated";
import { useCartReconcile } from "@/hooks/useCartReconcile";
import { createClient } from "@/lib/supabase/client";
import { ItemModifierModal } from "@/components/customer/ItemModifierModal";
import type { MenuItem, MenuOptionGroup } from "@/lib/types/domain";

export function CartView() {
  const { restaurantId, restaurantName, lines, setQuantity, setNotes, removeItem, addItem } = useCartStore();
  const hydrated = useHydrated();
  // Audit 2026-08-11: live reconciliation — refresh stale unit prices in place
  // and NAME the lines that died instead of letting place_order reject blind.
  const reconcile = useCartReconcile();
  const deadCount = lines.filter((l) => l.unavailable).length;
  // Edit-in-place (Baymard: remove-and-re-add for one topping drives cart
  // abandonment) — "Modifică" fetches the item + its option groups fresh (the
  // cart line itself only stores the flat option ids/labels) and reopens the
  // same modifier modal pre-filled, instead of forcing a raw delete.
  const [editing, setEditing] = useState<{ line: CartLine; item: MenuItem; groups: MenuOptionGroup[] } | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);

  async function openEditor(line: CartLine) {
    setEditLoadingId(line.lineId);
    const supabase = createClient();
    const [{ data: itemRow }, { data: groupRows }] = await Promise.all([
      supabase.from("menu_items").select("*").eq("id", line.menuItemId).single(),
      supabase
        .from("menu_option_groups")
        .select("*, menu_options(*)")
        .eq("menu_item_id", line.menuItemId)
        .order("sort_order")
        .order("sort_order", { referencedTable: "menu_options" }),
    ]);
    setEditLoadingId(null);
    if (!itemRow) return;
    const groups: MenuOptionGroup[] = ((groupRows ?? []) as unknown as (MenuOptionGroup & { menu_options: MenuOptionGroup["options"] })[]).map(
      (g) => ({ ...g, options: (g.menu_options ?? []).filter((o) => o.is_available) }),
    );
    setEditing({ line, item: itemRow as MenuItem, groups });
  }
  // #9 — fetch the restaurant's fee + minimum so the cart can show the FULL total,
  // not just a subtotal the button implied was the total.
  const [summary, setSummary] = useState<{ delivery_fee_mdl: number; min_order_amount_mdl: number } | null>(null);
  // #6 — announce cart removals to screen readers (a removed line otherwise just
  // vanishes silently and focus is dropped).
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (!restaurantId) return;
    let stale = false;
    createClient()
      .from("restaurants")
      .select("delivery_fee_mdl, min_order_amount_mdl")
      .eq("id", restaurantId)
      .single()
      .then(({ data }) => {
        if (!stale) setSummary(data);
      });
    return () => {
      stale = true;
    };
  }, [restaurantId]);

  // Until hydrated, render the same empty branch the server did (the persisted
  // cart isn't available server-side) — prevents a hydration mismatch/flash.
  if (!hydrated || !restaurantId || lines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <span className="text-6xl" aria-hidden>🛒</span>
        <p className="text-white/60">Coșul tău este gol.</p>
        <Link
          href="/restaurants"
          className="rounded-full bg-primary-dark px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-darker"
        >
          Vezi restaurantele
        </Link>
      </div>
    );
  }

  const subtotal = cartSubtotal(lines);

  return (
    <div className="flex flex-col gap-4">
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {reconcile.repriced.length > 0 && (
        <p className="rounded-xl bg-sky-400/10 px-4 py-3 text-sm text-sky-300 ring-1 ring-sky-400/30">
          Restaurantul a actualizat prețurile: {reconcile.repriced.map((r) => `${r.name} (${r.from}→${r.to} MDL)`).join(", ")}. Totalul de mai jos e cel real.
        </p>
      )}
      {deadCount > 0 && (
        <p className="rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary ring-1 ring-primary/30">
          {deadCount === 1 ? "Un articol nu mai este disponibil" : `${deadCount} articole nu mai sunt disponibile`} — e marcat mai jos; șterge-l ca să poți continua.
        </p>
      )}
      <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">{restaurantName}</h2>
        <ul className="flex flex-col gap-4">
          {lines.map((line) => (
            <li key={line.lineId} className={`flex items-center justify-between gap-3 ${line.unavailable ? "rounded-xl bg-primary/5 p-2 ring-1 ring-primary/30" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${line.unavailable ? "text-white/50 line-through" : "text-white"}`}>{line.name}</p>
                {line.optionsLabel && <p className="truncate text-xs text-white/40">{line.optionsLabel}</p>}
                {line.unavailable ? (
                  <p className="text-xs font-semibold text-primary">Nu mai este disponibil</p>
                ) : (
                  <p className="text-sm text-white/50">{line.priceMdl} MDL</p>
                )}
                {/* C2: kitchen note per dish (place_order -> order_items.notes, printed on the ticket). */}
                <input
                  value={line.notes ?? ""}
                  onChange={(e) => setNotes(line.lineId, e.target.value)}
                  maxLength={140}
                  placeholder="Notă pentru bucătărie (ex. fără wasabi)"
                  aria-label={`Notă pentru ${line.name}`}
                  className="mt-1.5 w-full rounded-lg bg-white/5 px-2 py-1 text-xs text-white placeholder-white/30 ring-1 ring-white/10 outline-none focus:ring-primary/60"
                />
              </div>
              {/* Bolt-style quantity stepper */}
              <div className="flex items-center gap-1 rounded-full bg-white/5 p-1 ring-1 ring-white/10">
                <button
                  type="button"
                  onClick={() => setQuantity(line.lineId, line.quantity - 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-white/80 transition hover:bg-white/10"
                  aria-label="Scade cantitatea"
                >
                  −
                </button>
                <span className="w-7 text-center text-sm font-bold text-white">{line.quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(line.lineId, line.quantity + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-white/80 transition hover:bg-white/10"
                  aria-label="Crește cantitatea"
                >
                  +
                </button>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="w-20 text-right font-semibold text-white">{line.priceMdl * line.quantity} MDL</span>
                <div className="flex items-center gap-2">
                  {line.optionIds.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditor(line)}
                        disabled={editLoadingId === line.lineId}
                        aria-label={`Modifică ${line.name}`}
                        className="text-xs text-gold underline underline-offset-4 transition hover:text-gold-light disabled:opacity-50"
                      >
                        {editLoadingId === line.lineId ? "Se încarcă…" : "Modifică"}
                      </button>
                      <span className="text-white/20" aria-hidden>
                        ·
                      </span>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setAnnounce(`${line.name} eliminat din coș`);
                      removeItem(line.lineId);
                    }}
                    aria-label={`Șterge ${line.name} din coș`}
                    className="text-xs text-white/40 underline underline-offset-4 transition hover:text-primary"
                  >
                    Șterge
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <div className="flex items-center justify-between text-white">
          <span className="font-medium">Subtotal</span>
          <span className="font-semibold">{subtotal} MDL</span>
        </div>
        {summary && (
          <>
            <div className="mt-1.5 flex items-center justify-between text-sm text-white/60">
              <span>Livrare</span>
              <span>{Number(summary.delivery_fee_mdl) === 0 ? "Gratuită" : `${summary.delivery_fee_mdl} MDL`}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
              <span className="font-medium">Total</span>
              <span className="text-lg font-bold text-gold">{subtotal + Number(summary.delivery_fee_mdl)} MDL</span>
            </div>
            {subtotal < Number(summary.min_order_amount_mdl) && (
              <p className="mt-2 text-xs text-primary">
                Comandă minimă {summary.min_order_amount_mdl} MDL — mai adaugă{" "}
                {Number(summary.min_order_amount_mdl) - subtotal} MDL.
              </p>
            )}
          </>
        )}
        <p className="mt-1 text-xs text-white/40">Bacșișul (opțional) se adaugă la checkout.</p>
      </div>

      <Link
        href="/checkout"
        aria-disabled={deadCount > 0 || (summary ? subtotal < Number(summary.min_order_amount_mdl) : undefined)}
        className={`rounded-full py-4 text-center text-[15px] font-semibold text-white transition ${
          deadCount > 0 || (summary && subtotal < Number(summary.min_order_amount_mdl))
            ? "pointer-events-none bg-white/10 text-white/40"
            : "bg-primary-dark hover:bg-primary-darker"
        }`}
      >
        {deadCount > 0
          ? "Șterge articolele indisponibile"
          : summary
            ? subtotal < Number(summary.min_order_amount_mdl)
              ? "Comandă sub minim"
              : `Continuă spre plată · ${subtotal + Number(summary.delivery_fee_mdl)} MDL`
            : `Continuă spre plată · ${subtotal} MDL`}
      </Link>

      {editing && (
        <ItemModifierModal
          item={editing.item}
          groups={editing.groups}
          initialOptionIds={editing.line.optionIds}
          initialQuantity={editing.line.quantity}
          onClose={() => setEditing(null)}
          onAdd={(options, qty) => {
            if (restaurantId && restaurantName) {
              removeItem(editing.line.lineId);
              addItem(restaurantId, restaurantName, editing.item, options);
              if (qty > 1) setQuantity(cartLineId(editing.item.id, options.optionIds), qty);
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
