// Releasing an accepted order before pickup (courier_release_order). Pure + deps injected, so the flow is
// tested for what it does; the server enforces who / when / the daily cap.

export type ReleaseReason = "vehicle_problem" | "personal_emergency" | "restaurant_delay" | "other";

export const RELEASE_REASONS: Record<ReleaseReason, string> = {
  vehicle_problem: "Problemă cu vehiculul",
  personal_emergency: "Urgență personală",
  restaurant_delay: "Restaurantul întârzie mult",
  other: "Alt motiv",
};

/** Only before pickup: after it the food is with the courier and only support can reassign. */
export function releaseVisible(step: "pickup" | "delivering" | "delivered"): boolean {
  return step === "pickup";
}

export async function releaseOrderFlow(
  orderId: string,
  reason: ReleaseReason,
  deps: {
    release: (orderId: string, reason: ReleaseReason) => Promise<{ error: string | null; left: number | null }>;
    stopGps: () => Promise<unknown>;
    alert: (title: string, text: string) => void;
    leave: () => void;
  },
): Promise<void> {
  const { error, left } = await deps.release(orderId, reason);
  if (error) {
    deps.alert("Nu ai putut renunța", error);
    return;
  }
  await deps.stopGps();
  deps.alert("Ai renunțat la comandă", `Comanda merge la alt curier. Îți mai rămân ${left ?? 0} renunțări azi.`);
  deps.leave();
}
