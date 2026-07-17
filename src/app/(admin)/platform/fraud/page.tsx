import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { FraudFlagReviewButton } from "@/components/admin/FraudFlagReviewButton";

type FraudDetail = {
  speed_kmh?: number;
  distance_km?: number;
  elapsed_s?: number;
  order_id?: string | null;
};

type FraudFlagRow = {
  id: string;
  courier_id: string;
  kind: string;
  detail: FraudDetail;
  created_at: string;
  reviewed_at: string | null;
  couriers: { full_name: string; phone: string } | null;
};

const KIND_LABEL: Record<string, string> = {
  gps_teleport: "Teleportare GPS",
};

export default async function PlatformFraudPage() {
  const supabase = await createClient();
  // RLS fraud_flags_admin_read scopes this to platform_admin; /platform/* is also
  // role-gated by src/proxy.ts. FK courier_id->couriers.id drives the embedded join.
  const { data } = await supabase
    .from("fraud_flags")
    .select("*, couriers(full_name, phone)")
    .order("created_at", { ascending: false })
    .limit(100);

  const flags = (data ?? []) as FraudFlagRow[];

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Semnalări</h1>
      <p className="mb-6 text-sm text-white/50">
        Semnale de plauzibilitate — se înregistrează, nu blochează. Triază-le manual.
      </p>

      {flags.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
          <span className="text-5xl" aria-hidden>🛡️</span>
          <p className="text-white/60">Nicio semnalare — totul pare în regulă.</p>
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-white/50">
              <th className="py-2">Curier</th>
              <th className="py-2">Semnal</th>
              <th className="py-2">Detalii</th>
              <th className="py-2">Data</th>
              <th className="py-2">Stare</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.id} className="border-b border-white/5 align-top">
                <td className="py-3">
                  <p className="font-medium text-white">{flag.couriers?.full_name ?? "—"}</p>
                  <p className="text-xs text-white/40">{flag.couriers?.phone}</p>
                </td>
                <td className="py-3">
                  <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-primary/30">
                    {KIND_LABEL[flag.kind] ?? flag.kind}
                  </span>
                </td>
                <td className="py-3 text-white/70">
                  {flag.detail.speed_kmh != null ? (
                    <>
                      {flag.detail.speed_kmh} km/h pe {flag.detail.distance_km} km în {flag.detail.elapsed_s}s
                      {flag.detail.order_id && (
                        <>
                          {" · "}
                          <Link href={`/platform/orders`} className="text-gold hover:underline">
                            Comanda
                          </Link>
                        </>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-3 text-white/50">
                  {new Date(flag.created_at).toLocaleString("ro-RO", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-3">
                  {flag.reviewed_at ? (
                    <span className="text-xs text-emerald-400">Verificat ✓</span>
                  ) : (
                    <FraudFlagReviewButton flagId={flag.id} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
