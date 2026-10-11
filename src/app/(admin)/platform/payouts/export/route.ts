import { createClient } from "@/lib/supabase/server";
import { buildPayoutBankCsv } from "@/lib/payouts/bankCsv";
import { loadPendingBankRows } from "@/lib/payouts/pendingBankRows";

// Bank transfer list (CSV) for every pending payout with an IBAN. Fail-closed admin gate here:
// the proxy only does UX gating, RLS would hide the rows anyway but a 403 is clearer.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Neautentificat.", { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "platform_admin") return new Response("Doar pentru administratorul platformei.", { status: 403 });

  const { csv } = buildPayoutBankCsv(await loadPendingBankRows(supabase));
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Chisinau" });
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="plati-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
