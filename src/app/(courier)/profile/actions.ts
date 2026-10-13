"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";
import { ibanError, normalizeIban } from "@/components/courier/payoutIban";

export type PayoutAccountState = { error: string | null; saved?: boolean };

// The bank account the weekly courier payout goes to. set_payout_account (ADMIN's RPC, 000402)
// re-checks that the caller owns the courier row and the IBAN checksum; the client rule runs here
// too so a bypassed form still gets the Romanian reason. Every change lands in
// payout_account_changes (000410) — the admin sees it before money is sent.
export async function saveCourierPayoutAccount(_prev: PayoutAccountState, formData: FormData): Promise<PayoutAccountState> {
  const rawIban = String(formData.get("iban") ?? "");
  const holder = String(formData.get("holder_name") ?? "").trim();
  const problem = ibanError(rawIban);
  if (problem) return { error: problem };
  if (holder.length < 2) return { error: "Scrie numele titularului contului." };
  try {
    const { supabase, user } = await requireUser();
    const { data: courier } = await supabase.from("couriers").select("id").eq("user_id", user.id).maybeSingle();
    if (!courier) return { error: "Contul tău nu este înregistrat ca curier." };
    const { error } = await supabase.rpc("set_payout_account", {
      p_recipient_type: "courier",
      p_recipient_id: courier.id,
      p_iban: normalizeIban(rawIban),
      p_holder_name: holder,
    });
    if (error) {
      return {
        error: /IBAN invalid/.test(error.message)
          ? "IBAN-ul nu e valid — verifică cifrele."
          : "Contul nu s-a putut salva. Reîncearcă.",
      };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  revalidatePath("/profile");
  return { error: null, saved: true };
}
