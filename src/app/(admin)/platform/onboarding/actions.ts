"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/require";

// Review is platform_admin-only. The RPC is security definer: on approve it
// promotes the applicant's profile role and creates the courier / restaurant
// row from the stored details jsonb. requirePlatformAdmin throws on non-admins
// (RLS on onboarding_applications is the real boundary either way).
export async function reviewApplication(
  id: string,
  approve: boolean,
  note?: string,
): Promise<{ error: string | null }> {
  try {
    const { supabase } = await requirePlatformAdmin();

    const { error } = await supabase.rpc("review_onboarding_application", {
      p_id: id,
      p_approve: approve,
      p_note: note?.trim() || undefined,
    });

    if (error) return { error: error.message };

    revalidatePath("/platform/onboarding");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
