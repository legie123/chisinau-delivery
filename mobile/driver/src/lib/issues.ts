// What a courier can report on an active delivery (RPC courier_report_issue). The leg rule mirrors
// the server: restaurant problems only before pickup, customer problems only after it. Pure (no
// supabase import) so vitest runs it.

export type IssueKind = "running_late" | "restaurant_delayed" | "venue_not_found" | "customer_unreachable" | "address_wrong";

export const ISSUE_LABELS: Record<IssueKind, string> = {
  running_late: "Întârzii",
  restaurant_delayed: "Comanda nu e gata la restaurant",
  venue_not_found: "Nu găsesc restaurantul",
  customer_unreachable: "Clientul nu răspunde",
  address_wrong: "Adresa e greșită sau incompletă",
};

export function issueKindsFor(step: "pickup" | "delivering" | "delivered"): IssueKind[] {
  if (step === "pickup") return ["running_late", "restaurant_delayed", "venue_not_found"];
  if (step === "delivering") return ["running_late", "customer_unreachable", "address_wrong"];
  return [];
}

/** `isNew` = the RPC's answer: false when this kind was already reported for the order. */
export function issueReportedText(isNew: boolean): string {
  return isNew
    ? "Am anunțat echipa. Rămâi la comandă, te contactăm dacă e nevoie."
    : "Ai raportat deja asta pentru comanda de față — echipa e anunțată.";
}

/** What the screen shows after a report: the kind's label and whether it was new or a repeat. */
export function describeReport(kind: IssueKind, isNew: boolean): { title: string; text: string } {
  return { title: ISSUE_LABELS[kind], text: issueReportedText(isNew) };
}
