"use client";

import { useState, useTransition } from "react";
import { setCourierActive } from "@/app/(admin)/platform/couriers/actions";

export function CourierActiveToggle({ courierId, initialActive }: { courierId: string; initialActive: boolean }) {
  const [active, setActive] = useState(initialActive);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const next = !active;
    setActive(next);
    startTransition(async () => {
      try {
        await setCourierActive(courierId, next);
      } catch {
        setActive(!next);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      className={`rounded-full px-3 py-1 text-xs ${
        active
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
          : "bg-white/10 text-white/50"
      }`}
    >
      {active ? "Activ" : "Dezactivat"}
    </button>
  );
}
