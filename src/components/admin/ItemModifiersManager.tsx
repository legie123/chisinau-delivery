"use client";

import { useActionState, useState } from "react";
import { BrandWatermark } from "@/components/brand/BrandMark";
import type { MenuOptionGroup } from "@/lib/types/domain";
import {
  addOption,
  createOptionGroup,
  deleteOption,
  deleteOptionGroup,
  type ActionState,
} from "@/app/(admin)/restaurant/menu/modifier-actions";

// (deleteOption is used via useActionState below.)

const initial: ActionState = { error: null };

// Partner authoring for menu modifiers — "Dragons Alliance Premium" design DNA:
// a dark tinted panel ringed in gold, serif gold heading, a dragon watermark,
// gold price accents, pill inputs. Lets a restaurant define option groups
// (required/optional, max-select) and their priced options per menu item.
export function ItemModifiersManager({ itemId, groups }: { itemId: string; groups: MenuOptionGroup[] }) {
  const [groupState, createGroup] = useActionState(createOptionGroup, initial);
  const [addingGroup, setAddingGroup] = useState(false);

  return (
    <div
      className="relative mt-3 overflow-hidden rounded-2xl p-5 ring-1 ring-gold/20"
      style={{ background: "linear-gradient(105deg,#141024 0%,#241826 70%,#2e1c2a 100%)" }}
    >
      <BrandWatermark px={80} className="absolute -right-3 -top-4 opacity-[0.06]" />

      <div className="relative flex items-center justify-between gap-3">
        <h4 className="font-serif text-lg font-bold text-gold">Modificatori</h4>
        <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/40">
          {groups.length} {groups.length === 1 ? "grup" : "grupuri"}
        </span>
      </div>
      <p className="relative mt-1 text-xs text-white/45">
        Grupuri de opțiuni pentru acest produs — obligatorii (alege 1) sau opționale, fiecare cu preț.
      </p>

      {/* Existing groups */}
      <div className="relative mt-4 flex flex-col gap-3">
        {groups.length === 0 && (
          <p className="rounded-xl bg-white/[0.03] px-4 py-4 text-center text-sm text-white/40 ring-1 ring-white/[0.06]">
            Niciun modificator încă — adaugă un grup mai jos (ex. &bdquo;Sos&rdquo;, &bdquo;Mărime&rdquo;, &bdquo;Extra&rdquo;).
          </p>
        )}
        {groups.map((g) => (
          <GroupCard key={g.id} group={g} />
        ))}
      </div>

      {/* Add group */}
      <div className="relative mt-4">
        {addingGroup ? (
          <form action={createGroup} className="flex flex-col gap-3 rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/10">
            <input type="hidden" name="menu_item_id" value={itemId} />
            <input
              name="name"
              placeholder="Nume grup (ex. Sos)"
              required
              className="rounded-lg bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-gold/50"
            />
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" name="is_required" className="accent-primary" />
                Obligatoriu (alege 1)
              </label>
              <label className="flex items-center gap-2 text-sm text-white/70">
                Max opțiuni
                <input
                  name="max_select"
                  type="number"
                  min={1}
                  defaultValue={1}
                  className="w-16 rounded-lg bg-white/5 px-2 py-1.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-gold/50"
                />
              </label>
            </div>
            {groupState.error && <p className="text-xs text-primary">{groupState.error}</p>}
            <div className="flex gap-2">
              <button type="submit" className="rounded-full bg-primary-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-darker">
                Adaugă grup
              </button>
              <button type="button" onClick={() => setAddingGroup(false)} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/15">
                Renunță
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAddingGroup(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gold/30 py-3 text-sm font-semibold text-gold/80 transition hover:border-gold/60 hover:text-gold"
          >
            + Adaugă grup de opțiuni
          </button>
        )}
      </div>
    </div>
  );
}

function GroupCard({ group }: { group: MenuOptionGroup }) {
  const [optState, addOpt] = useActionState(addOption, initial);
  const [delState, delGroup] = useActionState(deleteOptionGroup, initial);
  const [, delOpt] = useActionState(deleteOption, initial);
  const [addingOption, setAddingOption] = useState(false);

  return (
    <div className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/[0.07]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">{group.name}</span>
          {group.is_required ? (
            <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">Obligatoriu</span>
          ) : (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/50">Opțional</span>
          )}
          <span className="text-[11px] text-white/35">max {group.max_select}</span>
        </div>
        <form action={delGroup}>
          <input type="hidden" name="group_id" value={group.id} />
          <button type="submit" aria-label={`Șterge grupul ${group.name}`} className="text-xs text-white/40 transition hover:text-primary">
            Șterge
          </button>
        </form>
      </div>
      {delState.error && <p className="mt-1 text-xs text-primary">{delState.error}</p>}

      {/* Options */}
      <ul className="mt-3 flex flex-col gap-1.5">
        {group.options.length === 0 && <li className="text-xs text-white/35">Nicio opțiune încă.</li>}
        {group.options.map((o) => (
          <li key={o.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
            <span className="text-white/85">{o.name}</span>
            <span className="flex items-center gap-3">
              <span className="text-gold">{Number(o.price_delta_mdl) > 0 ? `+${o.price_delta_mdl} MDL` : "gratuit"}</span>
              <form action={delOpt}>
                <input type="hidden" name="option_id" value={o.id} />
                <button type="submit" aria-label={`Șterge opțiunea ${o.name}`} className="text-white/30 transition hover:text-primary">
                  ✕
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>

      {/* Add option */}
      {addingOption ? (
        <form action={addOpt} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="group_id" value={group.id} />
          <input
            name="name"
            placeholder="Opțiune (ex. Teriyaki)"
            required
            className="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-gold/50"
          />
          <div className="flex items-center gap-1 rounded-lg bg-white/5 px-2 ring-1 ring-white/10 focus-within:ring-gold/50">
            <span className="text-xs text-white/40">+</span>
            <input name="price_delta_mdl" type="number" min={0} step="1" defaultValue={0} className="w-16 bg-transparent py-2 text-sm text-white outline-none" />
            <span className="text-xs text-white/40">MDL</span>
          </div>
          <button type="submit" className="rounded-full bg-primary-dark px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-darker">
            Adaugă
          </button>
          <button type="button" onClick={() => setAddingOption(false)} className="rounded-full px-2 py-2 text-sm text-white/50 hover:text-white/80">
            Renunță
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAddingOption(true)}
          className="mt-3 text-sm font-semibold text-gold/80 transition hover:text-gold"
        >
          + opțiune
        </button>
      )}
      {optState.error && <p className="mt-1 text-xs text-primary">{optState.error}</p>}
    </div>
  );
}
