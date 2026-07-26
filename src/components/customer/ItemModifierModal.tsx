"use client";

import { useMemo, useState } from "react";
import type { MenuItem, MenuOptionGroup } from "@/lib/types/domain";
import type { ChosenOptions } from "@/lib/orders/cart";

// Bolt-style item customization modal: shows the item's option groups (required =
// single-pick radios; optional multi = checkboxes up to max_select), a live price,
// and an Add button. Returns the chosen options to the caller, which adds to cart.
export function ItemModifierModal({
  item,
  groups,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  groups: MenuOptionGroup[];
  onClose: () => void;
  onAdd: (options: ChosenOptions) => void;
}) {
  // selected option ids, keyed by group
  const [selected, setSelected] = useState<Record<string, string[]>>({});

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
    onAdd({ optionIds: allIds, optionsLabel: label, unitPriceMdl: unit });
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
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#14141f] p-6 ring-1 ring-white/10 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-xl font-bold text-white">{item.name}</h2>
            {item.description && <p className="mt-1 text-sm text-white/50">{item.description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5">
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

        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className="mt-6 w-full rounded-full bg-primary-dark py-4 text-[15px] font-semibold text-white transition hover:bg-primary-darker disabled:cursor-not-allowed disabled:opacity-40"
        >
          {canAdd ? `Adaugă · ${unit} MDL` : "Alege opțiunile obligatorii"}
        </button>
      </div>
    </div>
  );
}
