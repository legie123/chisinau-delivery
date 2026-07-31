import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPublicCourierTariffHistory, getPublicPricingHistory } from "@chisinau/shared-api";

export const metadata = { title: "Cum funcționează · Dragons Delivery" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ro-RO", { year: "numeric", month: "long", day: "numeric" });
}

function formatPct(n: number): string {
  return `${Number(n).toLocaleString("ro-RO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

function formatMdl(n: number): string {
  return `${Number(n).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MDL`;
}

export default async function HowItWorksPage() {
  const supabase = await createClient();
  const [pricingHistory, tariffHistory] = await Promise.all([
    getPublicPricingHistory(supabase),
    getPublicCourierTariffHistory(supabase),
  ]);

  return (
    <main className="mx-auto max-w-3xl flex-1 px-5 pb-24 pt-10">
      <h1 className="font-serif text-3xl font-bold text-gold">Cum funcționează</h1>
      <p className="mt-3 text-sm text-white/40">Ultima actualizare: iulie 2026</p>
      <p className="mt-4 text-[15px] leading-relaxed text-white/70">
        Patru reguli care guvernează felul în care Dragons Delivery alocă livrările și calculează tarifele — scrise
        aici pentru oricine, cu sau fără cont: clienți, curieri care iau în calcul platforma, presă sau autorități.
      </p>

      <div className="mt-8 flex flex-col gap-6 text-[15px] leading-relaxed text-white/70">
        <section>
          <h2 className="mb-2 font-semibold text-white">1. Dispecerizare anonimă</h2>
          <p>
            Când o comandă e gata de ridicare, oferta se trimite curierului ales doar pe baza distanței până la
            restaurant și a tipului de vehicul. Algoritmul nu are acces la — și deci nu poate ține cont de — nume,
            vârstă, sex sau orice altă caracteristică personală a curierului. Scorul de alocare este strict
            timpul estimat până la restaurant.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold text-white">2. Refuzul nu e penalizat</h2>
          <p>
            Un curier poate refuza o ofertă fără nicio consecință. Nu există, structural, în codul de dispecerizare
            un termen care să scadă scorul unui curier pentru oferte refuzate în trecut — nu e dezactivat sau setat
            la zero, pur și simplu nu există. (Există, separat, o protecție automată doar pentru oferte total
            ignorate — 3 la rând fără niciun răspuns trec curierul offline, pentru siguranța lui; refuzul explicit
            nu contează în acest calcul.)
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold text-white">3. Tariful afișat e minim</h2>
          <p>
            Taxa de livrare afișată clientului la comandă este stabilită o singură dată, în momentul finalizării
            comenzii, și nu mai poate fi redusă ulterior — o interdicție impusă direct la nivel de bază de date, nu
            doar o promisiune de politică internă. La fel, tariful curierului pentru o livrare este o{" "}
            <em>quotă-podea</em> calculată când restaurantul marchează comanda gata de ridicare: la finalul livrării,
            curierul primește fie acea quotă, fie o sumă mai mare (dacă a așteptat mai mult decât era estimat) —
            niciodată mai puțin.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold text-white">4. Tarife versionate și publicate</h2>
          <p className="mb-4">
            Comisionul platformei și tariful curierului se schimbă doar prin versiuni noi, imutabile — o modificare
            nu poate rescrie istoricul, doar adaugă o intrare nouă, cu data de la care intră în vigoare. Ambele
            istorice sunt publice, mai jos, fără cont necesar.
          </p>

          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">
            Istoric comision platformă
          </h3>
          <div className="mb-6 overflow-x-auto rounded-xl ring-1 ring-white/10">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-white/50">
                  <th className="px-3 py-2 font-medium">În vigoare de la</th>
                  <th className="px-3 py-2 font-medium">Comision curier</th>
                  <th className="px-3 py-2 font-medium">Comision restaurant</th>
                  <th className="px-3 py-2 font-medium">Notă</th>
                </tr>
              </thead>
              <tbody>
                {pricingHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-white/40">
                      Istoricul nu poate fi afișat momentan.
                    </td>
                  </tr>
                ) : (
                  pricingHistory.map((row) => (
                    <tr key={row.id} className="border-b border-white/[0.06] last:border-0">
                      <td className="px-3 py-2 text-white/80">{formatDate(row.effective_from)}</td>
                      <td className="px-3 py-2 font-medium text-gold">{formatPct(row.courier_pct)}</td>
                      <td className="px-3 py-2 font-medium text-gold">{formatPct(row.restaurant_pct)}</td>
                      <td className="px-3 py-2 text-white/50">{row.note ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">
            Istoric tarif curier (per livrare)
          </h3>
          <div className="overflow-x-auto rounded-xl ring-1 ring-white/10">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-white/50">
                  <th className="px-3 py-2 font-medium">În vigoare de la</th>
                  <th className="px-3 py-2 font-medium">Bază</th>
                  <th className="px-3 py-2 font-medium">Per km</th>
                  <th className="px-3 py-2 font-medium">Așteptare</th>
                  <th className="px-3 py-2 font-medium">Grație</th>
                  <th className="px-3 py-2 font-medium">Vreme</th>
                  <th className="px-3 py-2 font-medium">Notă</th>
                </tr>
              </thead>
              <tbody>
                {tariffHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-3 text-white/40">
                      Istoricul nu poate fi afișat momentan.
                    </td>
                  </tr>
                ) : (
                  tariffHistory.map((row) => (
                    <tr key={row.id} className="border-b border-white/[0.06] last:border-0">
                      <td className="px-3 py-2 text-white/80">{formatDate(row.effective_from)}</td>
                      <td className="px-3 py-2 font-medium text-gold">{formatMdl(row.base_mdl)}</td>
                      <td className="px-3 py-2 font-medium text-gold">{formatMdl(row.per_km_mdl)}/km</td>
                      <td className="px-3 py-2 font-medium text-gold">{formatMdl(row.wait_per_min_mdl)}/min</td>
                      <td className="px-3 py-2 text-white/80">{row.wait_grace_minutes} min</td>
                      <td className="px-3 py-2 text-white/80">
                        {Number(row.weather_surcharge_mdl) > 0 ? `+${formatMdl(row.weather_surcharge_mdl)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-white/50">{row.note ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm text-white/50">
            Cât timp păstrăm datele folosite pentru livrare (poziție GPS, adresă, istoric comenzi) este documentat
            separat, cu ferestrele exacte de retenție, în{" "}
            <Link href="/confidentialitate" className="text-gold underline underline-offset-4">
              Politica de confidențialitate
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
