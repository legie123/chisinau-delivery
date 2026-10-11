import { createClient } from "@/lib/supabase/server";
import { PricingForm, TariffForm } from "./TarifeForms";

// Commissions and the courier tariff: the version in effect now, the scheduled ones, the history,
// and a form for a NEW version (versioned + immutable; the past cannot be rewritten — 20261012000491).
// Business numbers are PROVISIONAL until the founder ratifies them (CLAUDE.md, money invariants).

type Pricing = { id: string; effective_from: string; courier_commission_pct: number; restaurant_commission_pct: number; tip_max_mdl: number; note: string | null };
type Tariff = { id: string; effective_from: string; base_mdl: number; per_km_mdl: number; wait_per_min_mdl: number; wait_grace_minutes: number; weather_surcharge_mdl: number; note: string | null };

const fmt = new Intl.DateTimeFormat("ro-MD", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Chisinau" });

function current<T extends { effective_from: string }>(rows: T[]): T | null {
  const now = Date.now();
  return rows.find((r) => new Date(r.effective_from).getTime() <= now) ?? null; // rows are newest-first
}

const isFuture = (iso: string) => new Date(iso).getTime() > Date.now();

function Badge({ row, cur }: { row: { id: string; effective_from: string }; cur: { id: string } | null }) {
  if (cur && row.id === cur.id) return <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">în vigoare</span>;
  if (isFuture(row.effective_from)) return <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold">programată</span>;
  return <span className="text-xs text-white/40">istoric</span>;
}

export default async function PlatformTarifePage() {
  const supabase = await createClient();
  const [{ data: p, error: pe }, { data: t, error: te }] = await Promise.all([
    supabase.from("pricing_config").select("id, effective_from, courier_commission_pct, restaurant_commission_pct, tip_max_mdl, note").order("effective_from", { ascending: false }).limit(20),
    supabase.from("courier_tariff_config").select("id, effective_from, base_mdl, per_km_mdl, wait_per_min_mdl, wait_grace_minutes, weather_surcharge_mdl, note").order("effective_from", { ascending: false }).limit(20),
  ]);
  const pricing = (p ?? []) as Pricing[];
  const tariff = (t ?? []) as Tariff[];
  const curP = current(pricing);
  const curT = current(tariff);

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Comisioane și tarife</h1>
        <p className="text-sm text-white/50">Valori provizorii până la ratificarea fondatorului. Fiecare schimbare e o versiune nouă, cu motiv, vizibilă și în Audit.</p>
      </div>

      {pe || te ? (
        <p className="rounded-xl bg-primary/10 p-4 text-sm text-primary">Configurația nu a putut fi citită. Încearcă din nou.</p>
      ) : (
        <>
          <PricingForm courierPct={Number(curP?.courier_commission_pct ?? 0)} restaurantPct={Number(curP?.restaurant_commission_pct ?? 0)} />
          <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
            <h2 className="mb-3 font-medium text-white">Istoric comisioane</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-white/50"><tr><th className="py-1">De la</th><th>Curier</th><th>Restaurant</th><th>Bacșiș max</th><th>Motiv</th><th /></tr></thead>
              <tbody>
                {pricing.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-1.5">{fmt.format(new Date(r.effective_from))}</td>
                    <td>{Number(r.courier_commission_pct)}%</td>
                    <td>{Number(r.restaurant_commission_pct)}%</td>
                    <td>{Number(r.tip_max_mdl)} MDL</td>
                    <td className="text-white/60">{r.note ?? "—"}</td>
                    <td><Badge row={r} cur={curP} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <TariffForm base={Number(curT?.base_mdl ?? 0)} perKm={Number(curT?.per_km_mdl ?? 0)} waitMin={Number(curT?.wait_per_min_mdl ?? 0)}
            grace={Number(curT?.wait_grace_minutes ?? 3)} weather={Number(curT?.weather_surcharge_mdl ?? 0)} />
          <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
            <h2 className="mb-3 font-medium text-white">Istoric tarif curier</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-white/50"><tr><th className="py-1">De la</th><th>Bază</th><th>/km</th><th>Așteptare/min</th><th>Grație</th><th>Vreme</th><th>Motiv</th><th /></tr></thead>
              <tbody>
                {tariff.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-1.5">{fmt.format(new Date(r.effective_from))}</td>
                    <td>{Number(r.base_mdl)} MDL</td>
                    <td>{Number(r.per_km_mdl)} MDL</td>
                    <td>{Number(r.wait_per_min_mdl)} MDL</td>
                    <td>{r.wait_grace_minutes} min</td>
                    <td>{Number(r.weather_surcharge_mdl)} MDL</td>
                    <td className="text-white/60">{r.note ?? "—"}</td>
                    <td><Badge row={r} cur={curT} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
