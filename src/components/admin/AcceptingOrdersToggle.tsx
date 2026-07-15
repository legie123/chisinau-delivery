"use client";

import { useState, useTransition } from "react";
import { toggleAcceptingOrders } from "@/app/(admin)/restaurant/hours/actions";

export function AcceptingOrdersToggle({ initialValue }: { initialValue: boolean }) {
  const [accepting, setAccepting] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  const [failed, setFailed] = useState(false);

  function handleToggle() {
    const next = !accepting;
    setAccepting(next);
    setFailed(false);
    startTransition(async () => {
      const result = await toggleAcceptingOrders(next);
      if (result.error) {
        setAccepting(!next);
        setFailed(true);
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
      {failed ? "Nu s-a salvat — reîncearcă" : accepting ? "Acceptăm comenzi acum" : "Comenzi oprite temporar"}
    </button>
  );
}
