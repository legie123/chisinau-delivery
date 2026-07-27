"use client";

import { useMemo, useState } from "react";
import type { MenuItem, MenuOptionGroup } from "@/lib/types/domain";
import type { ChosenOptions } from "@/lib/orders/cart";

// Bolt/Wolt-style item customization modal: full-bleed photo header, the item's
// option groups (required = single-pick radios; optional multi = checkboxes up
// to max_select), a qty stepper, and a sticky live-total CTA. Returns the chosen
// options + quantity to the caller, which adds to cart.
//
// initialOptionIds/initialQuantity let a caller pre-fill the modal from an
// existing cart line — the edit-in-place flow (CartView "Modifică") reopens
// this same modal instead of forcing remove-and-re-add for one topping.
export function ItemModifierModal({
  item,
  groups,
  initialOptionIds,
  initialQuantity = 1,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  groups: MenuOptionGroup[];
  initialOptionIds?: string[];
  initialQuantity?: number;
  onClose: () => void;
  onAdd: (options: ChosenOptions, quantity: number) => void;
}) {
  // selected option ids, keyed by group — seeded from initialOptionIds when editing.
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    if (!initialOptionIds || initialOptionIds.length === 0) return {};
    const chosen = new Set(initialOptionIds);
    const out: Record<string, string[]> = {};
    for (const g of groups) {
      const picked = g.options.filter((o) => chosen.has(o.id)).map((o) => o.id);
      if (picked.length > 0) out[g.id] = picked;
    }
    return out;
  });
  const [qty, setQty] = useState(Math.max(1, initialQuantity));

  const allIds = useMemo(() => Object.values(selected).flat(), [selected]);
  const optionById = useMemo(() => {
    const m = new Map<string, { name: string; price: number; group: string }>();
    for (const g of groups) for (const o of g.options) m.set(o.id, { name: o.name, price: Number(o.price_delta_mdl), group: g.name });
    return m;
  }, [groups]);

  const delta = allIds.reduce((s, id) => s + (optionById.get(id)?.price ?? 0), 0);
  const unit = Number(item.price_mdl) + delta;

  // every required group must have at least its minimum (>=1) selected
  const canAdd = groups.every((g) => {
    const n = (selected[g.id] ?? []).length;
    if (g.is_required && n < Math.max(g.min_select, 1)) return false;
    return n >= g.min_select && n <= g.max_select;
  });

  function toggle(group: MenuOptionGroup, optionId: string) {
    setSelected((prev) => {
      const cur = prev[group.id] ?? [];
      if (group.max_select === 1) {
        return { ...prev, [group.id]: [optionId] }; // radio: replace
      }
      if (cur.includes(optionId)) return { ...prev, [group.id]: cur.filter((x) => x !== optionId) };
      if (cur.length >= group.max_select) return prev; // at max — ignore
      return { ...prev, [group.id]: [...cur, optionId] };
    });
  }

  function handleAdd() {
    if (!canAdd) return;
    const label = groups
      .flatMap((g) => (selected[g.id] ?? []).map((id) => optionById.get(id)?.name).filter(Boolean))
      .join(", ");
    onAdd({ optionIds: allIds, optionsLabel: label, unitPriceMdl: unit }, qty);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Personalizează ${item.name}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl bg-[#14141f] ring-1 ring-white/10 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Full-bleed photo header — the floating close button lives on the image. */}
        <div className="relative h-48 w-full shrink-0 overflow-hidden bg-white/5 sm:h-56">
          {item.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.photo_url} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-white/10 to-transparent" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/30" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70"
          >
            ✕
          </button>
          <div className="absolute inset-x-0 bottom-0 p-5">
            <h2 className="font-serif text-xl font-bold text-white drop-shadow-sm">{item.name}</h2>
          </div>
        </div>

        <div className="flex flex-col gap-5 p-6">
          {item.description && <p className="-mt-2 text-sm text-white/50">{item.description}</p>}
          {groups.map((g) => (
            <fieldset key={g.id}>
              <legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                {g.name}
                {g.is_required ? (
                  <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">Obligatoriu</span>
                ) : (
                  <span className="text-xs font-normal text-white/40">
                    opțional{g.max_select > 1 ? ` · max ${g.max_select}` : ""}
                  </span>
                )}
              </legend>
              <div className="flex flex-col gap-1.5">
                {g.options.map((o) => {
                  const checked = (selected[g.id] ?? []).includes(o.id);
                  const disabled = !o.is_available;
                  return (
                    <label
                      key={o.id}
                      className={`flex cursor-pointer items-center justify-between rounded-xl px-4 py-3 text-[15px] ring-1 transition ${
                        checked ? "bg-primary/10 ring-primary/40" : "bg-white/5 ring-white/10 hover:bg-white/10"
                      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type={g.max_select === 1 ? "radio" : "checkbox"}
                          name={g.id}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(g, o.id)}
                          className="accent-primary"
                        />
                        <span className="text-white/90">{o.name}</span>
                      </span>
                      {Number(o.price_delta_mdl) > 0 && (
                        <span className="text-sm text-white/50">+{o.price_delta_mdl} MDL</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        {/* Sticky footer — qty stepper doubles as the live price preview. */}
        <div className="sticky bottom-0 flex items-center gap-4 border-t border-white/10 bg-[#14141f]/95 p-4 backdrop-blur sm:rounded-b-3xl">
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/5 p-1 ring-1 ring-white/10">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              aria-label="Scade cantitatea"
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-white/80 transition hover:bg-white/10"
            >
              −
            </button>
            <span className="w-7 text-center text-sm font-bold text-white">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((q) => q + 1)}
              aria-label="Crește cantitatea"
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-white/80 transition hover:bg-white/10"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="flex-1 rounded-full bg-primary-dark py-3.5 text-[15px] font-semibold text-white transition hover:bg-primary-darker disabled:cursor-not-allowed disabled:opacity-40"
          >
            {canAdd ? `Adaugă ${qty} · ${qty * unit} MDL` : "Alege opțiunile obligatorii"}
          </button>
        </div>
      </div>
    </div>
  );
}
