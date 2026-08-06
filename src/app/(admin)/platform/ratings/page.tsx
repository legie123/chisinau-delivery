import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type LowRating = {
  id: string;
  order_id: string;
  order_number: string;
  target_type: "restaurant" | "courier";
  stars: number;
  comment: string | null;
  restaurant_name: string | null;
  courier_name: string | null;
  created_at: string;
};

export default async function PlatformRatingsPage() {
  const supabase = await createClient();
  // admin_low_ratings has has_role('platform_admin') baked into the view + RLS
  // on the base tables; /platform/* is also role-gated by src/proxy.ts.
  const { data } = await supabase
    .from("admin_low_ratings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const ratings = (data ?? []) as LowRating[];

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Reclamații</h1>
      <p className="mb-6 text-sm text-white/50">
        Aprecieri de 3 stele sau mai puțin — semnale de la clienți despre livrare
        sau preparat. Triază-le și intervino unde e nevoie.
      </p>

      {ratings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
          <span className="text-5xl" aria-hidden>
            ⭐
          </span>
          <p className="text-white/60">Nicio reclamație — clienții sunt mulțumiți.</p>
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-white/50">
              <th className="py-2">Notă</th>
              <th className="py-2">Ținta</th>
              <th className="py-2">Comentariu</th>
              <th className="py-2">Comanda</th>
              <th className="py-2">Data</th>
            </tr>
          </thead>
          <tbody>
            {ratings.map((r) => (
              <tr key={r.id} className="border-b border-white/5 align-top">
                <td className="py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                      r.stars <= 2
                        ? "bg-primary/15 text-primary ring-primary/30"
                        : "bg-gold/15 text-gold ring-gold/30"
                    }`}
                    aria-label={`${r.stars} din 5 stele`}
                  >
                    {"★".repeat(r.stars)}
                    <span className="text-white/25">{"★".repeat(5 - r.stars)}</span>
                  </span>
                </td>
                <td className="py-3">
                  <p className="font-medium text-white">
                    {r.target_type === "restaurant" ? r.restaurant_name ?? "—" : r.courier_name ?? "—"}
                  </p>
                  <p className="text-xs text-white/40">
                    {r.target_type === "restaurant" ? "Restaurant" : "Curier"}
                  </p>
                </td>
                <td className="py-3 max-w-md text-white/70">{r.comment?.trim() || <span className="text-white/30">—</span>}</td>
                <td className="py-3">
                  <Link href={`/platform/orders/${r.order_id}`} className="text-gold hover:underline">
                    {r.order_number}
                  </Link>
                </td>
                <td className="py-3 text-white/50">
                  {new Date(r.created_at).toLocaleString("ro-RO", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
