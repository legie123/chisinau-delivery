import { createClient } from "@/lib/supabase/server";
import {
  currentWeekRange,
  formatShiftDuration,
  shiftReachesTarget,
  summarizeEarnings,
  summarizeShifts,
  type EarningsOrder,
  type ShiftEarningsOrder,
} from "@/app/(courier)/_lib/earnings";
import type { CourierShift, Payout } from "@/lib/types/domain";

// "Câștiguri" — the courier's own money view: #3b canonical model — net after
// commission, tips included, scoped to the current calendar week (same Mon-Sun
// boundary payout periods use) — plus the weekly payout history the platform
// has actually settled to them. RLS scopes payouts to their own rows.
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });

function PayoutStatusBadge({ status }: { status: Payout["status"] }) {
  if (status === "paid")
    return (
      <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
        Plătit ✓
      </span>
    );
  if (status === "failed")
    return <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">Eșuat</span>;
  return <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-semibold text-gold">În așteptare</span>;
}

export default async function CourierEarningsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courier } = await supabase
    .from("couriers")
    .select("id, referral_code")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  if (!courier) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16 text-center">
        <p className="text-white/60">Contul tău nu este înregistrat ca curier.</p>
      </main>
    );
  }

  const { start: weekStart, end: weekEnd } = currentWeekRange();

  const [{ data: weekOrders }, { data: payoutRows }, { data: closedShifts }] = await Promise.all([
    supabase
      .from("orders")
      .select("delivery_fee_mdl, courier_fee_mdl, tip_mdl, payment_status")
      .eq("courier_id", courier.id)
      .eq("status", "delivered")
      .gte("delivered_at", weekStart.toISOString())
      .lt("delivered_at", weekEnd.toISOString()),
    supabase
      .from("payouts")
      .select("*")
      .eq("recipient_type", "courier")
      .eq("recipient_id", courier.id)
      .order("created_at", { ascending: false }),
    // Faza 5 #5 — last 10 completed shifts ("ture"), most recent first.
    supabase
      .from("courier_shifts")
      .select("id, started_at, ended_at")
      .eq("courier_id", courier.id)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  // Tariff transparency (audit §2.1): the CURRENT versioned commission — used both
  // for the banner below AND the Net/Comision math, so the page never shows one
  // rate in the banner and a different (hardcoded) rate in the numbers.
  const { data: pricing } = await supabase.rpc("current_pricing_config");
  const courierPct = (pricing as { courier_commission_pct: number } | null)?.courier_commission_pct ?? null;

  const week = (weekOrders ?? []) as EarningsOrder[];
  const weekSummary = summarizeEarnings(week, courierPct ?? undefined);
  const payouts = (payoutRows ?? []) as Payout[];

  // ended_at is guaranteed non-null by the query filter above; narrow the type
  // once here instead of casting at every call site below.
  const shifts = ((closedShifts ?? []) as Pick<CourierShift, "id" | "started_at" | "ended_at">[]).filter(
    (s): s is { id: string; started_at: string; ended_at: string } => s.ended_at != null,
  );
  const earliestShiftStart = shifts.length > 0 ? shifts[shifts.length - 1].started_at : null;
  const { data: shiftOrders } = earliestShiftStart
    ? await supabase
        .from("orders")
        .select("delivery_fee_mdl, courier_fee_mdl, tip_mdl, payment_status, delivered_at")
        .eq("courier_id", courier.id)
        .eq("status", "delivered")
        .gte("delivered_at", earliestShiftStart)
    : { data: [] as ShiftEarningsOrder[] };
  const shiftSummaries = summarizeShifts(shifts, (shiftOrders ?? []) as ShiftEarningsOrder[]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="font-serif text-2xl font-bold text-white">Câștiguri</h1>
      <p className="mb-4 mt-1 text-sm text-white/50">Comisioanele tale de livrare și plățile săptămânale.</p>
      {courierPct != null && (
        <p className="mb-6 rounded-xl bg-white/[0.04] px-4 py-2.5 text-sm text-white/70 ring-1 ring-white/[0.06]">
          Tarif curent: comision <span className="font-semibold text-gold">{courierPct}%</span> pe taxa de livrare ·
          bacșișul e <span className="font-semibold text-white">100% al tău</span>. Orice schimbare e anunțată din timp.
        </p>
      )}

      <section className="mb-8 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <p className="text-sm text-white/50">Săptămâna aceasta (net, după comision)</p>
        <p className="mt-2 text-3xl font-bold text-gold">{weekSummary.netMdl} MDL</p>
        <p className="mt-1 text-sm text-white/50">
          {weekSummary.ordersCount} {weekSummary.ordersCount === 1 ? "livrare încasată" : "livrări încasate"} · taxă livrare + bacșiș
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-white/40">Brut</p>
            <p className="mt-0.5 font-medium text-white">{weekSummary.grossMdl} MDL</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Comision</p>
            <p className="mt-0.5 font-medium text-white/70">−{weekSummary.commissionMdl} MDL</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Net</p>
            <p className="mt-0.5 font-semibold text-gold">{weekSummary.netMdl} MDL</p>
          </div>
        </div>
        {weekSummary.pendingCount > 0 && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300/90 ring-1 ring-amber-500/20">
            ⚠️ {weekSummary.pendingCount} {weekSummary.pendingCount === 1 ? "livrare neîncasată" : "livrări neîncasate"} nu apar
            aici — vezi Istoric.
          </p>
        )}
      </section>

      {/* Faza 5 #5 — gross earnings PER SHIFT ("tura"). The 600 MDL audit target is
          a FLOOR for the cue, never a limit and never a window — see
          shiftReachesTarget: a shift above the band's top is a better shift. */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/60">Ture recente</h2>
      {shiftSummaries.length === 0 ? (
        <div className="mb-8 rounded-2xl bg-white/[0.04] px-4 py-8 text-center text-sm text-white/50 ring-1 ring-white/[0.06]">
          Nicio tură încheiată încă — apare aici după ce te deconectezi din livrare.
        </div>
      ) : (
        <ul className="mb-8 flex flex-col gap-2.5">
          {shiftSummaries.map((s) => {
            const reachedTarget = shiftReachesTarget(s.grossMdl);
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/[0.06]"
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {new Date(s.startedAt).toLocaleDateString("ro-RO", { day: "numeric", month: "short" })} ·{" "}
                    {formatShiftDuration(s.startedAt, s.endedAt)}
                  </p>
                  <p className="mt-0.5 text-xs text-white/50">
                    {s.ordersCount} {s.ordersCount === 1 ? "livrare" : "livrări"}
                  </p>
                </div>
                <p className={`text-lg font-semibold ${reachedTarget ? "text-gold" : "text-white/70"}`}>
                  {s.grossMdl} MDL
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/60">Plăți</h2>
      {payouts.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.04] px-4 py-10 text-center text-sm text-white/50 ring-1 ring-white/[0.06]">
          Nicio plată încă — apar aici după prima decontare.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {payouts.map((p) => (
            <li key={p.id} className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-white">
                  {fmtDate(p.period_start)} – {fmtDate(p.period_end)}
                </p>
                <PayoutStatusBadge status={p.status} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-white/40">Comenzi</p>
                  <p className="mt-0.5 font-medium text-white">{p.orders_count}</p>
                </div>
                <div>
                  <p className="text-xs text-white/40">Brut</p>
                  <p className="mt-0.5 font-medium text-white">{p.gross_mdl} MDL</p>
                </div>
                <div>
                  <p className="text-xs text-white/40">Comision</p>
                  <p className="mt-0.5 font-medium text-white/70">−{p.commission_mdl} MDL</p>
                </div>
                <div>
                  <p className="text-xs text-white/40">Net</p>
                  <p className="mt-0.5 text-lg font-bold text-gold">{p.net_mdl} MDL</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Faza 5 #4 — referral: platforma contorizează, bonusul e decizie umană */}
      {courier.referral_code && (
        <section className="mt-10 rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/10">
          <h2 className="font-serif text-lg font-bold text-gold">Recomandă un curier</h2>
          <p className="mt-1 text-sm text-white/55">
            Colegul tău menționează codul tău la înscriere. Bonusul se plătește când
            atinge 50 de livrări în primele 30 de zile.
          </p>
          <p className="mt-3 inline-block rounded-xl bg-white/5 px-4 py-2 font-mono text-xl font-bold tracking-[0.3em] text-white ring-1 ring-gold/30">
            {courier.referral_code}
          </p>
        </section>
      )}
    </main>
  );
}
