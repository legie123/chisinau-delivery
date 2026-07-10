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
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
      }`}
    >
      {accepting ? "Acceptăm comenzi acum" : "Comenzi oprite temporar"}
    </button>
  );
}
