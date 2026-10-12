import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exportLinesCsv, type ExportLine } from "@/lib/payouts/bankCsv";

// Bank transfer file, rendered from a FROZEN export batch (20261012000411):
//   POST  -> admin_create_payout_export() freezes the batch, then the file of that batch is returned;
//   GET ?id=<batch> -> the same file again (re-download, no new batch).
// Creating a batch is a POST on purpose: a GET can be prefetched. Fail-closed admin gate here; RLS and
// the RPC's own has_role check stay the real boundary.
async function admin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: new Response("Neautentificat.", { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "platform_admin") return { supabase, error: new Response("Doar pentru administratorul platformei.", { status: 403 }) };
  return { supabase, error: null };
}

async function fileFor(supabase: Awaited<ReturnType<typeof createClient>>, exportId: string) {
  const { data, error } = await supabase
    .from("payout_export_lines")
    .select("recipient_type, recipient_id, name, iban, holder_name, net_mdl, payout_ids")
    .eq("export_id", exportId)
    .order("name");
  if (error) return new Response("Nu am putut citi exportul.", { status: 500 });
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Chisinau" });
  return new Response("﻿" + exportLinesCsv(exportId, (data ?? []) as ExportLine[]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="plati-${day}-lot-${exportId.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST() {
  const { supabase, error } = await admin();
  if (error) return error;
  const { data: exportId, error: rpcError } = await supabase.rpc("admin_create_payout_export");
  if (rpcError || !exportId) return new Response(rpcError?.message ?? "Nimic de exportat.", { status: 409 });
  return fileFor(supabase, exportId as string);
}

export async function GET(request: NextRequest) {
  const { supabase, error } = await admin();
  if (error) return error;
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Lipsește lotul (?id=)." }, { status: 400 });
  return fileFor(supabase, id);
}
