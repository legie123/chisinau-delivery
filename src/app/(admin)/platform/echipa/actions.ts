"use server";

import { revalidatePath } from "next/cache";
import { RpcError, setPlatformAdmin } from "@chisinau/shared-api";
import { requirePlatformAdmin } from "@/lib/auth/require";

export type ActionState = { error: string | null; ok?: string };

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
