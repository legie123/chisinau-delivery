import { getPilotGoNoGo, getScalingTriggers } from "@chisinau/shared-api";
import { createClient } from "@/lib/supabase/server";

// Faza 5 — Pilot Command Center: tabelul go/no-go al auditului (§8 Faza 5) +
// declanșatoarele de scalare (Faza 6), fiecare cu query viu și pass/fail
// vizibil. READ-ONLY: niciun prag nu acționează nimic automat.

const STATUS_STYLE: Record<string, string> = {
  pass: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  fail: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
  no_data: "bg-white/5 text-white/40 ring-white/10",
  info: "bg-sky-500/15 text-sky-400 ring-sky-500/30",
};
const STATUS_LABEL: Record<string, string> = {
  pass: "PASS", fail: "FAIL", no_data: "fără date", info: "instrument",
};

export default async function PilotCommandPage() {
  const supabase = await createClient();
  const [kpis, triggers] = await Promise.all([
    getPilotGoNoGo(supabase),
    getScalingTriggers(supabase),
  ]);

  return (
    <main className="flex-1 px-5 pb-16 pt-6">
      <h1 className="font-serif text-2xl font-bold text-gold">Pilot — go / no-go</h1>
      <p className="mt-1 text-sm text-white/50">
        Țintele Fazei 5 din auditul master, calculate live. Recrutarea cohortelor se
        deblochează pe banda 600–1000 MDL/tură — nu pe marja platformei.
      </p>

      <div className="mt-5 overflow-x-auto rounded-2xl bg-white/[0.03] ring-1 ring-white/10">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-white/40">
              <th className="px-4 py-3">Indicator</th>
              <th className="px-4 py-3">Acum</th>
              <th className="px-4 py-3">Țintă</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {kpis.map((k) => (
              <tr key={k.kpi} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-white/85">{k.kpi}</td>
                <td className="px-4 py-3 font-semibold text-white">{k.value_text}</td>
                <td className="px-4 py-3 text-white/55">{k.target_text}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${STATUS_STYLE[k.status] ?? STATUS_STYLE.no_data}`}>
                    {STATUS_LABEL[k.status] ?? k.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 font-serif text-xl font-bold text-gold">Declanșatoare de scalare (Faza 6)</h2>
      <p className="mt-1 text-sm text-white/50">
        Fiecare investiție majoră are un declanșator numeric, nu un moment de entuziasm.
        Pragul de matching global e măsurat de simulatorul propriu (raport 2026-07-31).
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {triggers.map((t) => (
          <div key={t.trigger_name} className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-white/90">{t.trigger_name}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                t.armed
                  ? "bg-primary/15 text-primary ring-primary/30"
                  : "bg-white/5 text-white/40 ring-white/10"
              }`}>
                {t.armed ? "ARMAT" : "inactiv"}
              </span>
            </div>
            <p className="mt-2 text-lg font-bold text-white">{t.current_value}</p>
            <p className="mt-1 text-xs text-white/45">{t.threshold_text}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-white/35">
        Regula de aur a pilotului (audit §8): nu recruta al 16-lea curier înainte ca
        primii 15 să atingă ținta de câștig pe tură. Un declanșator ARMAT = începe
        conversația, nu implementarea automată.
      </p>
    </main>
  );
}
