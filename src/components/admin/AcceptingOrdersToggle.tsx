"use client";

import { useState, useTransition } from "react";
import { toggleAcceptingOrders } from "@/app/(admin)/restaurant/hours/actions";

export function AcceptingOrdersToggle({ initialValue }: { initialValue: boolean }) {
  const [accepting, setAccepting] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const next = !accepting;
    setAccepting(next);
    startTransition(async () => {
      try {
        await toggleAcceptingOrders(next);
      } catch {
        setAccepting(!next);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      className={`mb-6 w-fit rounded-full px-4 py-2 text-sm ${
        accepting
          ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
          : "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30"
      }`}
    >
      {accepting ? "Acceptăm comenzi acum" : "Comenzi oprite temporar"}
    </button>
  );
}
