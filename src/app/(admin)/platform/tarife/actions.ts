"use server";

import { revalidatePath } from "next/cache";
import { RpcError, setCourierTariff, setPricingConfig } from "@chisinau/shared-api";
import { requirePlatformAdmin } from "@/lib/auth/require";
import { chisinauLocalToIso } from "@/lib/admin/chisinauTime";

export type ActionState = { error: string | null; ok?: string };

const num = (fd: FormData, k: string) => {
  const raw = String(fd.get(k) ?? "").trim().replace(",", ".");
  return raw === "" ? NaN : Number(raw);
};

// When it starts: empty = now; otherwise Chișinău wall-clock time. The DB refuses the past.
function startOf(fd: FormData): { iso: string } | { error: string } {
  const raw = String(fd.get("effective_from") ?? "").trim();
  if (!raw) return { iso: new Date().toISOString() };
  const iso = chisinauLocalToIso(raw);
  return iso ? { iso } : { error: "Data de început nu e validă." };
}

function noteOf(fd: FormData): string | null {
  const note = String(fd.get("note") ?? "").trim();
  return note.length >= 5 ? note : null;
}

export async function setPricingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();
    const courier = num(fd, "courier_pct");
    const restaurant = num(fd, "restaurant_pct");
    if (![courier, restaurant].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) {
      return { error: "Comisioanele sunt procente între 0 și 100." };
    }
    const note = noteOf(fd);
    if (!note) return { error: "Scrie motivul schimbării (minim 5 caractere) — rămâne în istoric." };
    const start = startOf(fd);
    if ("error" in start) return { error: start.error };
    await setPricingConfig(supabase, courier, restaurant, start.iso, note);
    revalidatePath("/platform/tarife");
    revalidatePath("/platform/payouts");
    return { error: null, ok: "Versiune nouă de comisioane salvată." };
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Comisioanele nu au putut fi salvate." };
  }
}

export async function setTariffAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();
    const base = num(fd, "base_mdl");
    const perKm = num(fd, "per_km_mdl");
    const waitMin = num(fd, "wait_per_min_mdl");
    const grace = num(fd, "wait_grace_minutes");
    const weather = num(fd, "weather_surcharge_mdl");
    if (![base, perKm, waitMin, weather].every((v) => Number.isFinite(v) && v >= 0)) {
      return { error: "Sumele tarifului trebuie să fie numere ≥ 0." };
    }
    if (!Number.isInteger(grace) || grace < 0) return { error: "Minutele de grație sunt un număr întreg ≥ 0." };
    const note = noteOf(fd);
    if (!note) return { error: "Scrie motivul schimbării (minim 5 caractere) — curierii primesc anunțul." };
    const start = startOf(fd);
    if ("error" in start) return { error: start.error };
    await setCourierTariff(supabase, base, perKm, waitMin, grace, start.iso, note, weather);
    revalidatePath("/platform/tarife");
    return { error: null, ok: "Tarif nou salvat; curierii activi primesc anunțul." };
  } catch (err) {
    return { error: err instanceof RpcError ? err.userMessage : "Tariful nu a putut fi salvat." };
  }
}
