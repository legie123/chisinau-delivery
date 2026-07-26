"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/require";
import { reviewOnboardingApplication, RpcError } from "@chisinau/shared-api";

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

    await reviewOnboardingApplication(supabase, id, approve, note?.trim() || undefined);

    revalidatePath("/platform/onboarding");
    return { error: null };
  } catch (err) {
    return {
      error:
        err instanceof RpcError
          ? err.userMessage
          : err instanceof Error
            ? err.message
            : "A apărut o eroare.",
    };
  }
}
