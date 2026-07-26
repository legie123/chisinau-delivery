"use client";

import { useState, useTransition } from "react";
import { toggleAcceptingOrders } from "@/app/(admin)/restaurant/hours/actions";

export function AcceptingOrdersToggle({ initialValue }: { initialValue: boolean }) {
  const [accepting, setAccepting] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  const [failed, setFailed] = useState(false);

  // Re-sync on a fresh server render (adjust-during-render, like MenuItemRow).
  const [prevValue, setPrevValue] = useState(initialValue);
  if (prevValue !== initialValue) {
    setPrevValue(initialValue);
    setAccepting(initialValue);
  }

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
      className={`flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm ${
        accepting
          ? "bg-[color:var(--pg-amethyst-0)]/15 ring-1 ring-[color:var(--pg-amethyst-line)]"
          : "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30"
      }`}
    >
      {accepting && <span className="pg-live-dot" />}
      <span className={accepting ? "pg-amethyst-glow" : ""}>
        {failed ? "Nu s-a salvat — reîncearcă" : accepting ? "Acceptăm comenzi acum" : "Comenzi oprite temporar"}
      </span>
    </button>
  );
}
