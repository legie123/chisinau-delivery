"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";

// Onboarding + KYC is applicant-driven: a signed-in customer submits an
// application via the security-definer RPC (which stamps user_id = auth.uid()),
// then uploads KYC docs whose storage path is guarded by the same uid. These
// actions are called directly from client components with typed args (not
// FormData/useActionState), so they return richer shapes than { error }.

export type SubmitResult = { error: string | null; applicationId: string | null };

type ApplicantType = "courier" | "restaurant";

export async function submitApplication(
  type: ApplicantType,
  payload: Record<string, unknown>,
): Promise<SubmitResult> {
  try {
    const { supabase } = await requireUser();

    const fullName = String(payload.full_name ?? "").trim();
    const phone = String(payload.phone ?? "").trim();
    const email = String(payload.email ?? "").trim() || null;

    if (!fullName || !phone) {
      return { error: "Nume și telefon sunt obligatorii.", applicationId: null };
    }

    // details jsonb carries the type-specific fields the reviewer needs to
    // provision the courier / restaurant row on approval.
    let details: Record<string, unknown>;
    if (type === "courier") {
      details = { vehicle_type: String(payload.vehicle_type ?? "bike") };
    } else {
      const name = String(payload.name ?? "").trim();
      const slug = String(payload.slug ?? "").trim();
      const address = String(payload.address ?? "").trim();
      if (!name || !slug || !address) {
        return { error: "Nume, slug și adresă sunt obligatorii.", applicationId: null };
      }
      details = {
        name,
        slug,
        address,
        sector: String(payload.sector ?? "").trim() || null,
        cuisine_type: String(payload.cuisine_type ?? "other"),
        delivery_fee_mdl: Number(payload.delivery_fee_mdl ?? 0),
        min_order_amount_mdl: Number(payload.min_order_amount_mdl ?? 0),
      };
    }

    const { data, error } = await supabase.rpc("submit_onboarding_application", {
      p_type: type,
      p_full_name: fullName,
      p_phone: phone,
      p_email: email,
      p_details: details,
    });

    if (error) return { error: error.message, applicationId: null };

    revalidatePath("/devino-partener");
    return { error: null, applicationId: (data as string) ?? null };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "A apărut o eroare.",
      applicationId: null,
    };
  }
}

export async function addKycDocument(
  applicationId: string,
  docType: string,
  storagePath: string,
): Promise<{ error: string | null }> {
  try {
    const { supabase } = await requireUser();

    const { error } = await supabase.rpc("add_kyc_document", {
      p_application_id: applicationId,
      p_doc_type: docType,
      p_storage_path: storagePath,
    });

    if (error) return { error: error.message };

    revalidatePath("/devino-partener");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
