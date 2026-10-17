"use server";

import { revalidatePath } from "next/cache";
import { RpcError, setPlatformAdmin, authErrorText, mapPgError } from "@chisinau/shared-api";
import { requirePlatformAdmin } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = { error: string | null; ok?: string };

// Step 1 of 2: invite a future admin. Only an INVITED account (auth.users.invited_at, which needs the
// service key) can later be promoted — GoTrue auto-confirms signups, so a stranger who registered a
// colleague's email first would otherwise pass as "confirmed" (red-team round 5). The invite itself is
// audited through x-audit-actor (createAdminClient). Promotion is step 2, after they accept.
export async function inviteAdminAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { user: actor } = await requirePlatformAdmin();
    const email = String(fd.get("email") ?? "").trim();
    const fullName = String(fd.get("full_name") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email invalid." };
    if (fullName.length < 2) return { error: "Scrie numele persoanei." };
    const admin = createAdminClient(actor.id);
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName, role: "customer" } });
    if (inviteError) return { error: authErrorText(inviteError) };
    const { error: profileError } = await admin.from("profiles").upsert({ id: invited.user.id, full_name: fullName, role: "customer" }, { onConflict: "id" });
    if (profileError) return { error: mapPgError(profileError) };
    revalidatePath("/platform/echipa");
    return { error: null, ok: "Invitație trimisă. După ce acceptă și își setează parola, acordă-i dreptul de aici." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invitația nu a putut fi trimisă." };
  }
}

export async function setAdminAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();
    const email = String(fd.get("email") ?? "").trim();
    const grant = String(fd.get("grant") ?? "") === "true";
    const reason = String(fd.get("reason") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email invalid." };
    if (reason.length < 5) return { error: "Scrie motivul (minim 5 caractere) — rămâne în audit." };
    await setPlatformAdmin(supabase, email, grant, reason);
    revalidatePath("/platform/echipa");
    return { error: null, ok: grant ? "Drept de administrator acordat." : "Drept de administrator retras." };
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Schimbarea nu a putut fi salvată." };
  }
}
