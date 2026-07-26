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
    <section className="mb-6 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/50">Numerar în mână</p>
        <p className={`text-lg font-bold ${nearCap ? "text-primary" : "text-white"}`}>
          {status.balance_mdl} <span className="text-white/40">/ {status.cap_mdl} MDL</span>
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
        <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary ring-1 ring-primary/20">
          {status.offload_channel_text}
        </p>
      )}
    </section>
  );
}
