"use client";

import { useState, useTransition } from "react";
import { setRestaurantActive } from "@/app/(admin)/platform/restaurants/actions";

// Admin toggle for a restaurant's platform is_active flag — the activation hop that
// lets an onboarded restaurant actually go live (mirrors CourierActiveToggle).
export function RestaurantActiveToggle({ restaurantId, initialActive }: { restaurantId: string; initialActive: boolean }) {
  const [active, setActive] = useState(initialActive);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const [prevActive, setPrevActive] = useState(initialActive);
  if (prevActive !== initialActive) {
    setPrevActive(initialActive);
    setActive(initialActive);
  }

  function handleToggle() {
    const next = !active;
    setActive(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setRestaurantActive(restaurantId, next);
      if (result.error) {
        setActive(!next);
        setFailed(true);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      className={`rounded-full px-3 py-1 text-xs transition ${
        active ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" : "bg-white/10 text-white/50"
      }`}
    >
      {failed ? "Eroare" : active ? "Activ" : "Activează"}
    </button>
  );
}
