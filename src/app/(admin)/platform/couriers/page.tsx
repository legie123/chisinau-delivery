import { createClient } from "@/lib/supabase/server";
import { SectionTabs, crmTabs } from "@/components/admin/SectionTabs";
import { adminCourierCashStatus, type CourierCashStatus } from "@chisinau/shared-api";
import { asCourierId } from "@chisinau/shared-types";
import { InviteCourierForm } from "@/components/admin/InviteCourierForm";
import { CourierSuspensionControl } from "@/components/admin/CourierSuspensionControl";
import { CashOffloadControl } from "@/components/admin/CashOffloadControl";
import type { AdminCourierPilotKpiRow } from "@/lib/types/domain";

const VEHICLE_LABEL: Record<string, string> = {
  bike: "Bicicletă",
  e_bike: "E-bike",
  scooter: "Scuter",
  car: "Mașină",
  on_foot: "Pe jos",
};

// Faza 5 §8 go/no-go targets — the audit's numbers, not house opinion.
const SATISFACTION_TARGET = 4.5;
const SHIFT_TARGET_MIN = 600;
const SHIFT_TARGET_MAX = 1000;

function SatisfactionCell({ row }: { row: AdminCourierPilotKpiRow | undefined }) {
  if (!row || row.satisfaction_responses_4w === 0) {
    return <span className="text-white/30">—</span>;
  }
  const ok = row.satisfaction_avg_4w != null && row.satisfaction_avg_4w >= SATISFACTION_TARGET;
  return (
    <span className={ok ? "font-medium text-emerald-400" : "font-medium text-amber-400"}>
      {row.satisfaction_avg_4w}/5
      <span className="ml-1 text-xs text-white/40">({row.satisfaction_responses_4w})</span>
    </span>
  );
}

function ShiftEarningsCell({ row }: { row: AdminCourierPilotKpiRow | undefined }) {
  if (!row || row.shifts_14d === 0 || row.median_gross_per_shift_14d == null) {
    return <span className="text-white/30">—</span>;
  }
  const inBand =
    row.median_gross_per_shift_14d >= SHIFT_TARGET_MIN && row.median_gross_per_shift_14d <= SHIFT_TARGET_MAX;
  return (
    <span className={inBand ? "font-medium text-emerald-400" : "font-medium text-amber-400"}>
      {row.median_gross_per_shift_14d} MDL
      <span className="ml-1 text-xs text-white/40">({row.shifts_14d} ture)</span>
      {row.empty_shifts_14d > 0 && (
        <span
          className="ml-1 text-xs text-white/30"
          title="Ture cu 0 comenzi livrate (blip) — excluse din mediană, dar numărate mai sus"
        >
          {row.empty_shifts_14d} goale
        </span>
      )}
    </span>
  );
}

// Order 1 (pilot-critical) — cash balance chip. admin_courier_cash_status is
// per-courier (not a bulk view like admin_courier_pilot_kpis), so this is one
// call per row — fine at pilot fleet size; a hiccup on one courier must never
// blank the rest of the table.
function CashChip({ status }: { status: CourierCashStatus | null }) {
  if (!status) return <span className="text-white/30">—</span>;
  const atCap = status.balance_mdl >= status.cap_mdl;
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        atCap ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-white/5 text-white/60 ring-1 ring-white/10"
      }`}
    >
      {status.balance_mdl} / {status.cap_mdl} MDL
    </span>
  );
}

export default async function PlatformCouriersPage() {
  const supabase = await createClient();
  const [{ data: couriers }, { data: kpiRows }] = await Promise.all([
    supabase.from("couriers").select("*").order("full_name"),
    // Faza 5 #5 — satisfaction (rolling 4w) + gross/shift median (rolling 14d).
    supabase.from("admin_courier_pilot_kpis").select("*"),
  ]);

  const kpiByCourier = new Map((kpiRows ?? []).map((r) => [r.courier_id, r as AdminCourierPilotKpiRow]));

  const cashEntries = await Promise.all(
    (couriers ?? []).map(async (c) => {
      const status = await adminCourierCashStatus(supabase, asCourierId(c.id)).catch(() => null);
      return [c.id, status] as const;
    }),
  );
  const cashByCourier = new Map(cashEntries);

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">CRM</h1>
      <p className="mb-4 text-sm text-white/50">Curieri</p>
      <SectionTabs tabs={crmTabs()} current="/platform/couriers" />

      <InviteCourierForm />

      {couriers?.length === 0 ? (
        <p className="text-white/50">Niciun curier încă.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-2">Nume</th>
                <th className="py-2">Telefon</th>
                <th className="py-2">Vehicul</th>
                <th className="py-2">Status</th>
                <th className="py-2" title="Sondaj săptămânal, medie 4 săptămâni — țintă ≥4,5/5">
                  Satisfacție
                </th>
                <th className="py-2" title="Câștig brut mediana pe tură completă, ultimele 14 zile — țintă 600-1000 MDL">
                  Brut/tură
                </th>
                <th className="py-2" title="Numerar colectat, neîncă predat, față de plafon">
                  Numerar
                </th>
                <th className="py-2">Cont</th>
              </tr>
            </thead>
            <tbody>
              {couriers?.map((courier) => (
                <tr key={courier.id} className="border-b border-white/5">
                  <td className="py-2">{courier.full_name}</td>
                  <td className="py-2">{courier.phone}</td>
                  <td className="py-2">{VEHICLE_LABEL[courier.vehicle_type] ?? courier.vehicle_type}</td>
                  <td className="py-2">{courier.status}</td>
                  <td className="py-2">
                    <SatisfactionCell row={kpiByCourier.get(courier.id)} />
                  </td>
                  <td className="py-2">
                    <ShiftEarningsCell row={kpiByCourier.get(courier.id)} />
                  </td>
                  <td className="py-2">
                    <div className="flex flex-col items-start gap-1.5">
                      <CashChip status={cashByCourier.get(courier.id) ?? null} />
                      <CashOffloadControl
                        courierId={courier.id}
                        balanceMdl={Number(cashByCourier.get(courier.id)?.balance_mdl ?? 0)}
                      />
                    </div>
                  </td>
                  <td className="py-2">
                    <CourierSuspensionControl courierId={courier.id} initialActive={courier.is_active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
