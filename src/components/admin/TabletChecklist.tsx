"use client";

import { useCallback, useEffect, useState } from "react";
import { kitchenAlertAudio } from "@/lib/kitchen/alertAudio";

type Check = { label: string; ok: boolean | null; hint: string };
type BatteryManager = { charging: boolean };

// Live install check for the kitchen tablet: each line is measured on THIS device,
// not a static list. null = the browser can't tell (shown as "verifică manual").
export function TabletChecklist() {
  const [checks, setChecks] = useState<Check[] | null>(null);

  const measure = useCallback(async () => {
    const nav = navigator as Navigator & { standalone?: boolean; getBattery?: () => Promise<BatteryManager> };
    const battery = nav.getBattery ? await nav.getBattery().catch(() => null) : null;
    setChecks([
      {
        label: "Deschisă ca aplicație (pe ecranul principal)",
        ok: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
        hint: "Chrome → meniul ⋮ → „Adaugă pe ecranul de pornire”, apoi deschide „Partener” de acolo.",
      },
      {
        label: "Sunetul pentru comenzi noi e pornit",
        ok: kitchenAlertAudio.running(),
        hint: "Apasă „Testează sunetul” mai jos (o dată după fiecare pornire a aplicației) și ține volumul la maxim.",
      },
      {
        label: "Ecranul poate rămâne aprins",
        ok: "wakeLock" in navigator,
        hint: "Browserul nu permite. Actualizează Chrome sau setează „Ecran mereu pornit” din setările tabletei.",
      },
      {
        label: "Notificările sunt permise",
        ok: typeof Notification === "undefined" ? null : Notification.permission === "granted",
        hint: "Pe pagina Comenzi apasă „Activează notificările” și alege „Permite”.",
      },
      {
        label: "Tableta e la încărcător",
        ok: battery ? battery.charging : null,
        hint: "Ține tableta conectată permanent — o tabletă descărcată nu primește comenzi.",
      },
    ]);
  }, []);

  useEffect(() => {
    // Measured once on mount; "Verifică din nou" re-runs it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void measure();
  }, [measure]);

  async function testSound() {
    await kitchenAlertAudio.unlock();
    await measure();
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {(checks ?? []).map((c) => (
          <li key={c.label} className="pg-card flex gap-3 rounded-2xl px-4 py-3">
            <span aria-hidden className="text-lg">{c.ok === true ? "✅" : c.ok === false ? "⚠️" : "❔"}</span>
            <span className="min-w-0">
              <span className="block text-sm text-white">{c.label}</span>
              {c.ok !== true && (
                <span className="block text-xs text-white/55">
                  {c.ok === null ? "Verifică manual. " : ""}
                  {c.hint}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={testSound} className="pg-cta min-h-11 rounded-full px-5 text-sm">
          🔔 Testează sunetul
        </button>
        <button
          type="button"
          onClick={() => void measure()}
          className="min-h-11 rounded-full bg-white/5 px-4 text-sm text-white/75 ring-1 ring-white/10 hover:bg-white/10"
        >
          Verifică din nou
        </button>
      </div>
      <div className="pg-card rounded-2xl p-4 text-sm text-white/70">
        <p className="mb-2 font-semibold text-white">Și o singură dată, din setările tabletei:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Modul „Nu deranja” oprit, volumul media la maxim.</li>
          <li>Fixarea ecranului (Android: Setări → Securitate → „Fixează aplicația”), ca nimeni să nu închidă aplicația din greșeală.</li>
          <li>Wi-Fi stabil; dacă se poate, date mobile ca rezervă.</li>
          <li>Economisirea bateriei oprită pentru Chrome, altfel sistemul o adoarme în fundal.</li>
        </ul>
      </div>
    </div>
  );
}
