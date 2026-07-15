"use client";

import { useState, useTransition } from "react";
import { setOnlineStatus } from "@/app/(courier)/deliveries/actions";

export function OnlineToggle({ initialStatus }: { initialStatus: string }) {
  const [online, setOnline] = useState(initialStatus === "online");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const isOnDelivery = initialStatus === "on_delivery";

  function handleToggle() {
    const next = !online;
    setOnline(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setOnlineStatus(next);
      if (result.error) {
        setOnline(!next);
        setFailed(true);
      }
    });
  }

  if (isOnDelivery) {
    return (
      <span className="flex items-center gap-2 rounded-full bg-blue-500/15 px-5 py-2.5 text-sm font-semibold text-blue-400 ring-1 ring-blue-500/30">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" aria-hidden />
        În livrare
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
        online
          ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
          : "bg-white/5 text-white/50 ring-1 ring-white/10"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${online ? "animate-pulse bg-emerald-400" : "bg-white/30"}`} aria-hidden />
      {failed ? "Reîncearcă" : online ? "Online" : "Offline"}
    </button>
  );
}
