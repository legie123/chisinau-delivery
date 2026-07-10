"use client";

import { useState, useTransition } from "react";
import { setOnlineStatus } from "@/app/(courier)/deliveries/actions";

export function OnlineToggle({ initialStatus }: { initialStatus: string }) {
  const [online, setOnline] = useState(initialStatus === "online");
  const [pending, startTransition] = useTransition();
  const isOnDelivery = initialStatus === "on_delivery";

  function handleToggle() {
    const next = !online;
    setOnline(next);
    startTransition(async () => {
      try {
        await setOnlineStatus(next);
      } catch {
        setOnline(!next);
      }
    });
  }

  if (isOnDelivery) {
    return <span className="rounded-full bg-blue-100 px-4 py-2 text-sm text-blue-700 dark:bg-blue-900 dark:text-blue-300">În livrare</span>;
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      className={`w-fit rounded-full px-4 py-2 text-sm ${
        online
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {online ? "Online — primești comenzi" : "Offline"}
    </button>
  );
}
