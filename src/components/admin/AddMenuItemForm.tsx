"use client";

import { useRef, useState } from "react";
import { createMenuItem } from "@/app/(admin)/restaurant/menu/actions";
import { uploadMenuPhoto } from "@/lib/storage/uploadMenuPhoto";
import type { MenuCategory } from "@/lib/types/domain";

export function AddMenuItemForm({ restaurantId, categories }: { restaurantId: string; categories: MenuCategory[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    setHasPhoto(!!event.currentTarget.files?.[0]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const photo = formData.get("photo") as File | null;
    if (!photo || photo.size === 0) {
      setError("Fotografie obligatorie: preparatul întreg, centrat, clar, fără colaj/text/persoane.");
      return;
    }

    setPending(true);
    try {
      const url = await uploadMenuPhoto(restaurantId, photo);
      formData.set("photo_url", url);
      formData.delete("photo");

      const result = await createMenuItem({ error: null }, formData);
      if (result.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
        setHasPhoto(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "A apărut o eroare.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="pg-card mb-8 flex flex-col gap-3 rounded-2xl p-4"
    >
      <h2 className="font-medium">Articol nou</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="name" placeholder="Nume" required className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <input name="price_mdl" type="number" step="0.01" min="0.01" placeholder="Preț (MDL)" required className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <select name="category_id" className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60">
          <option value="">Fără categorie</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <input name="photo" type="file" accept="image/*" required onChange={handlePhotoChange} className="text-sm" />
          <p className="text-xs text-white/50">
            Fotografie obligatorie: preparatul întreg, centrat, clar, fără colaj/text/persoane (recomandat 16:9).
          </p>
        </div>
        <textarea
          name="description"
          placeholder="Descriere (opțional)"
          className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60 sm:col-span-2"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_catering_only" />
          Doar pentru catering
        </label>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending || !hasPhoto}
        className="pg-cta w-fit rounded-full px-5 py-2 text-sm disabled:opacity-50"
      >
        {pending ? "Se salvează..." : "Adaugă articol"}
      </button>
    </form>
  );
}
