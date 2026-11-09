// Restaurant-side: the courier card (name + "Sună curierul") makes sense only once a courier
// is actually attached and still on the way — assigned / picked up / en route. Same gate the
// queue page uses for its pickup banner, kept here so the detail page can't drift from it.
export const COURIER_CARD_STATUSES = ["courier_assigned", "picked_up", "en_route"] as const;

export function showsCourierCard(status: string, courierId: string | null | undefined): boolean {
  return !!courierId && (COURIER_CARD_STATUSES as readonly string[]).includes(status);
}
