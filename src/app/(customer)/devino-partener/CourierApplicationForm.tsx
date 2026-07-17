"use client";

import { useState, useTransition } from "react";
import { submitApplication } from "./actions";
import { DocumentUpload } from "@/components/onboarding/DocumentUpload";

const INPUT =
  "rounded-xl bg-white/5 px-4 py-3 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60";

export function CourierApplicationForm() {
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
      vehicle_type: String(fd.get("vehicle_type") ?? "bike"),
    };

    setError(null);
    startTransition(async () => {
      const result = await submitApplication("courier", payload);
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
            Statusul cererii tale: <span className="text-white">în așteptare</span>. Încarcă buletinul
            pentru a-ți verifica identitatea.
          </p>
        </div>
        <DocumentUpload
          applicationId={applicationId}
          docType="id_card"
          label="Buletin de identitate"
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]"
    >
      <input name="full_name" required aria-label="Nume complet" placeholder="Nume complet" className={INPUT} />
      <input name="phone" required aria-label="Telefon" placeholder="Telefon" className={INPUT} />
      <input
        name="email"
        type="email"
        aria-label="Email"
        placeholder="Email (opțional)"
        className={INPUT}
      />
      <select name="vehicle_type" defaultValue="bike" aria-label="Tip vehicul" className={INPUT}>
        <option value="bike">Bicicletă</option>
        <option value="e_bike">E-bike</option>
        <option value="scooter">Scuter</option>
        <option value="car">Mașină</option>
      </select>

      {error && <p className="text-sm text-primary">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
      >
        {pending ? "Se trimite..." : "Trimite cererea"}
      </button>
    </form>
  );
}
