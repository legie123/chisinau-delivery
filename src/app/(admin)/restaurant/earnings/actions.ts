"use server";

import { revalidatePath } from "next/cache";
import { requireOwnRestaurant } from "@/lib/auth/require";

export type PayoutAccountState = { error: string | null; saved?: boolean };

// The bank account the weekly payout goes to. set_payout_account (ADMIN's RPC)
// checks has_restaurant_access and the IBAN checksum; without an account the
// restaurant is left out of the bank CSV.
export async function savePayoutAccount(_prev: PayoutAccountState, formData: FormData): Promise<PayoutAccountState> {
  const iban = String(formData.get("iban") ?? "").replace(/\s/g, "").toUpperCase();
  const holder = String(formData.get("holder_name") ?? "").trim();
  if (!iban) return { error: "Completează IBAN-ul." };
  if (!holder) return { error: "Completează titularul contului (denumirea firmei)." };
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const { error } = await supabase.rpc("set_payout_account", {
      p_recipient_type: "restaurant",
      p_recipient_id: restaurantId,
      p_iban: iban,
      p_holder_name: holder,
    });
    if (error) {
      return {
        error: /IBAN invalid/.test(error.message)
          ? "IBAN invalid — verifică cifrele (în Moldova: MD + 22 de caractere)."
          : "Contul nu s-a putut salva. Reîncearcă.",
      };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  revalidatePath("/restaurant/earnings");
  return { error: null, saved: true };
}
