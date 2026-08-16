import type { CourierCashStatus } from "@chisinau/shared-api";

// Order 1 (pilot-critical) — cash float: how much the courier is currently
// holding vs. the hard cap, plus the full offload-channel text once they're
// close to it. Purely presentational (Server Component tree, no interaction);
// the actual online/offline hard-cap gate lives at the DB
// (set_courier_online_status), not here.
export function CashFloatStatus({ status }: { status: CourierCashStatus }) {
  const pct = status.cap_mdl > 0 ? Math.min(100, Math.round((status.balance_mdl / status.cap_mdl) * 100)) : 0;
  const nearCap = status.balance_mdl >= status.reactivation_threshold_mdl;

  return (
    // Singurul card de pe suprafața curierului cu text ROȘU, deci singurul cu
    // marjă de contrast aproape zero (`--primary` dă 4,78:1 pe navy plat — sub
    // el nu mai încape nimic). Celelalte carduri sunt albe pe navy, la ~17:1,
    // și pot rămâne ferestre translucide. Ăsta nu: cu `bg-white/[0.04]` peste
    // fundalul de sector, un felinar din fotografie ajungea exact sub cifră și
    // o cobora la 4,21:1. Substrat propriu, întunecat și aproape opac ⇒
    // contrastul cifrei nu mai depinde de ce se întâmplă să fie în spate.
    // Atmosfera rămâne vizibilă în jurul cardului, nu prin el.
    <section className="mb-6 rounded-2xl bg-[#0d0d1f]/92 p-5 ring-1 ring-white/[0.08]">
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/50">Numerar în mână</p>
        <p className={`text-lg font-bold ${nearCap ? "text-primary" : "text-white"}`}>
          {/* alb/40 dădea 3,78:1 pe numitor — plafonul e jumătatea care dă sens
              cifrei din stânga, nu un ornament. */}
          {status.balance_mdl} <span className="text-white/60">/ {status.cap_mdl} MDL</span>
        </p>
      </div>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label="Numerar colectat față de plafon"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className={`h-full rounded-full transition-all ${nearCap ? "bg-primary" : "bg-emerald-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {nearCap && (
        // Măsurat, nu presupus: roșul pe roșu dădea 4,39:1 pe substratul plat de
        // dinainte — deja sub pragul de 4,5:1 — și 3,75:1 după ce fundalul de
        // sector a apărut dedesubt. `--primary` e documentat în `globals.css` ca
        // insuficient pentru text (3,83:1). ROȘUL RĂMÂNE unde poartă înțelesul
        // („ceva care îl costă acum", §3): cifra, bara și rama. Dar propoziția
        // asta e o INSTRUCȚIUNE — unde să ducă banii, la ce oră — și un om care
        // caută o adresă pe stradă, noaptea, are nevoie s-o citească, nu s-o
        // recunoască după culoare.
        <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-xs text-white/90 ring-1 ring-primary/25">
          {status.offload_channel_text}
        </p>
      )}
    </section>
  );
}
