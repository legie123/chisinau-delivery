"use client";

import { useState, useTransition } from "react";
import { generatePayouts } from "@/app/(admin)/platform/payouts/actions";

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Default to the previous full week (Monday..Sunday) — the natural weekly
// payout period.
function lastWeekRange() {
  const now = new Date();
  const dowFromMonday = (now.getDay() + 6) % 7; // 0 = Monday
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - dowFromMonday);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  return { start: toISODate(lastMonday), end: toISODate(lastSunday) };
}

const inputClass =
  "rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60 [color-scheme:dark]";

export function GeneratePayoutsForm() {
  const def = lastWeekRange();
  const [start, setStart] = useState(def.start);
  const [end, setEnd] = useState(def.end);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleGenerate() {
    setMsg(null);
    startTransition(async () => {
      const res = await generatePayouts(start, end);
      if (res.error) {
        setMsg({ ok: false, text: res.error });
      } else {
        const n = res.count ?? 0;
        setMsg({ ok: true, text: n === 1 ? "1 plată generată/actualizată." : `${n} plăți generate/actualizate.` });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <h2 className="font-medium text-white">Generează plăți</h2>
      <p className="text-sm text-white/50">
        Construiește rândurile de plată (curieri + restaurante) din comenzile livrate în perioada aleasă.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Început
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Sfârșit
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </label>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={pending}
          className="rounded-full bg-primary-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
        >
          {pending ? "Se generează..." : "Generează plăți"}
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
