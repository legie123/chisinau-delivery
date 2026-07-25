"use client";

import { useState, useTransition } from "react";
import { submitApplication } from "./actions";
import { DocumentUpload } from "@/components/onboarding/DocumentUpload";

const INPUT =
  "rounded-xl bg-white/5 px-4 py-3 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60";

export function RestaurantApplicationForm() {
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      full_name: String(fd.get("full_name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? ""),
      name: String(fd.get("name") ?? ""),
      slug: String(fd.get("slug") ?? ""),
      address: String(fd.get("address") ?? ""),
      sector: String(fd.get("sector") ?? ""),
      cuisine_type: String(fd.get("cuisine_type") ?? "other"),
      delivery_fee_mdl: String(fd.get("delivery_fee_mdl") ?? "0"),
      min_order_amount_mdl: String(fd.get("min_order_amount_mdl") ?? "0"),
    };

    setError(null);
    startTransition(async () => {
      const result = await submitApplication("restaurant", payload);
      if (result.error) setError(result.error);
      else setApplicationId(result.applicationId);
    });
  }

  if (applicationId) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <div>
          <p className="font-serif text-lg font-semibold text-gold">Cerere trimisă ✓</p>
          <p className="mt-1 text-sm text-white/60">
            Statusul cererii tale: <span className="text-white">în așteptare</span>. Încarcă contractul
            semnat pentru validare.
          </p>
        </div>
        <DocumentUpload
          applicationId={applicationId}
          docType="restaurant_contract"
          label="Contract restaurant"
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]"
    >
      <p className="text-sm font-medium text-white/70">Persoană de contact</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="full_name" required aria-label="Nume complet" placeholder="Nume complet" className={INPUT} />
        <input name="phone" required aria-label="Telefon" placeholder="Telefon" className={INPUT} />
        <input
          name="email"
          type="email"
          aria-label="Email"
          placeholder="Email (opțional)"
          className={`${INPUT} sm:col-span-2`}
        />
      </div>

      <p className="mt-2 text-sm font-medium text-white/70">Detalii restaurant</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="name" required aria-label="Nume restaurant" placeholder="Nume restaurant" className={INPUT} />
        <input name="slug" required aria-label="Slug unic" placeholder="slug-unic" className={INPUT} />
        <input
          name="address"
          required
          aria-label="Adresă"
          placeholder="Adresă"
          className={`${INPUT} sm:col-span-2`}
        />
        <input name="sector" aria-label="Sector" placeholder="Sector (ex. Centru)" className={INPUT} />
        <select name="cuisine_type" defaultValue="sushi" aria-label="Tip bucătărie" className={INPUT}>
          <option value="sushi">Sushi</option>
          <option value="fine_dining">Fine dining</option>
          <option value="other">Altele</option>
        </select>
        <input
          name="delivery_fee_mdl"
          type="number"
          step="0.01"
          min="0"
          aria-label="Taxă livrare (MDL)"
          placeholder="Taxă livrare (MDL)"
          className={INPUT}
        />
        <input
          name="min_order_amount_mdl"
          type="number"
          step="0.01"
          min="0"
          aria-label="Comandă minimă (MDL)"
          placeholder="Comandă minimă (MDL)"
          className={INPUT}
        />
      </div>

      {error && <p className="text-sm text-primary">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-primary-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
      >
        {pending ? "Se trimite..." : "Trimite cererea"}
      </button>
    </form>
  );
}
