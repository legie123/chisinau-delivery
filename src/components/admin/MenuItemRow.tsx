"use client";

import { useRef, useState, useTransition } from "react";
import {
  deleteMenuItem,
  moveMenuItem,
  toggleItemAvailability,
  updateMenuItem,
} from "@/app/(admin)/restaurant/menu/actions";
import { createClient } from "@/lib/supabase/client";
import { uploadMenuPhoto } from "@/lib/storage/uploadMenuPhoto";
import type { MenuCategory, MenuItem } from "@/lib/types/domain";

const inputClass =
  "rounded-xl bg-white/5 px-3 py-2 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60";

export function MenuItemRow({ item }: { item: MenuItem }) {
  const [isAvailable, setIsAvailable] = useState(item.is_available);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // #17 — inline edit (expand-to-form). Categories are fetched on demand so
  // this row doesn't need a new prop threaded through the server page.
  const [editing, setEditing] = useState(false);
  const [categories, setCategories] = useState<MenuCategory[] | null>(null);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editFormRef = useRef<HTMLFormElement>(null);

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
      // deleteMenuItem already returns Romanian-friendly text, including the
      // FK-archive fallback message — surface it as-is.
      if (result.error) setError(result.error);
    });
  }

  function handleMove(direction: "up" | "down") {
    setError(null);
    startTransition(async () => {
      const result = await moveMenuItem(item.id, direction);
      if (result.error) setError(result.error);
    });
  }

  function openEdit() {
    setEditError(null);
    setEditing(true);
    if (!categories) {
      const supabase = createClient();
      supabase
        .from("menu_categories")
        .select("*")
        .eq("restaurant_id", item.restaurant_id)
        .order("sort_order")
        .then(({ data }) => setCategories((data ?? []) as MenuCategory[]));
    }
  }

  async function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditError(null);
    setEditPending(true);
    try {
      const formData = new FormData(event.currentTarget);
      const photo = formData.get("photo") as File | null;

      if (photo && photo.size > 0) {
        const url = await uploadMenuPhoto(item.restaurant_id, photo);
        formData.set("photo_url", url);
      } else {
        formData.set("photo_url", item.photo_url ?? "");
      }
      formData.delete("photo");
      formData.set("item_id", item.id);

      const result = await updateMenuItem({ error: null }, formData);
      if (result.error) {
        setEditError(result.error);
      } else {
        setEditing(false);
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "A apărut o eroare.");
    } finally {
      setEditPending(false);
    }
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
          {/* #41 — simple reorder within the category list */}
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => handleMove("up")}
              disabled={pending}
              aria-label="Mută mai sus"
              className="flex h-5 w-5 items-center justify-center rounded text-xs text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => handleMove("down")}
              disabled={pending}
              aria-label="Mută mai jos"
              className="flex h-5 w-5 items-center justify-center rounded text-xs text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              ↓
            </button>
          </div>
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
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-white/50 underline underline-offset-4"
            >
              Închide
            </button>
          ) : (
            <button
              type="button"
              onClick={openEdit}
              disabled={pending}
              className="text-xs text-white/70 underline underline-offset-4"
            >
              Editează
            </button>
          )}
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="rounded-full bg-primary-dark px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
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

      {editing && (
        <form
          ref={editFormRef}
          onSubmit={handleEditSubmit}
          className="mt-2 flex flex-col gap-2.5 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]"
        >
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <input name="name" defaultValue={item.name} placeholder="Nume" required className={inputClass} />
            <input
              name="price_mdl"
              type="number"
              step="0.01"
              min="0.01"
              defaultValue={item.price_mdl}
              placeholder="Preț (MDL)"
              required
              className={inputClass}
            />
            <select name="category_id" defaultValue={item.category_id ?? ""} className={inputClass}>
              <option value="">Fără categorie</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input name="photo" type="file" accept="image/*" className="text-sm" />
            <textarea
              name="description"
              defaultValue={item.description ?? ""}
              placeholder="Descriere (opțional)"
              className={`sm:col-span-2 ${inputClass}`}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_catering_only" defaultChecked={item.is_catering_only} />
              Doar pentru catering
            </label>
          </div>
          {editError && <p className="text-xs text-red-400">{editError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={editPending}
              className="w-fit rounded-full bg-primary-dark px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
            >
              {editPending ? "Se salvează..." : "Salvează"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-white/50 underline underline-offset-4"
            >
              Anulează
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
