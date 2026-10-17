"use server";

import { revalidatePath } from "next/cache";
import { RpcError, setCourierReleasePolicy } from "@chisinau/shared-api";
import { requirePlatformAdmin } from "@/lib/auth/require";
import { parseDailyCap } from "@/lib/admin/courierSignals";

export type ActionState = { error: string | null; ok?: string };

// A NEW version of the courier release cap (courier_release_policy is versioned + immutable).
// The RPC authorizes (platform_admin) and the DB checks 0..20; this only shapes the form input.
export async function setReleasePolicyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();
    const cap = parseDailyCap(String(fd.get("daily_cap") ?? ""));
    if (cap === null) return { error: "Plafonul e un număr întreg între 0 și 20 de renunțări pe zi." };
    const note = String(fd.get("note") ?? "").trim();
    if (note.length < 5) return { error: "Scrie motivul schimbării (minim 5 caractere) — rămâne în istoric." };
    await setCourierReleasePolicy(supabase, cap, note);
    revalidatePath("/platform/renuntari");
    return { error: null, ok: "Plafon nou salvat — se aplică de acum." };
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Plafonul nu a putut fi salvat." };
  }
}
