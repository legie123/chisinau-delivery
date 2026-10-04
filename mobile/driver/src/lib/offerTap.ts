// Tapping an offer push must land on the offer. The OfferCard lives only on the
// Map tab, and bottom tabs bring back whatever tab was open last — on
// Câștiguri/Comenzi/Profil the courier never saw the 30s offer, it expired as
// "ignored", and three of those auto-offline the courier.
// Pure (the expo-notifications slice is injected) so it is testable in node.

type TapResponse = {
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> | null } } };
};

export type TapSource = {
  addNotificationResponseReceivedListener(listener: (r: TapResponse) => void): { remove(): void };
  getLastNotificationResponse(): TapResponse | null;
  clearLastNotificationResponse(): void;
};

/** The push drain tags dispatch offers `offer:<id>` (src/app/api/push/drain/route.ts). */
export function isOfferTap(r: TapResponse): boolean {
  const tag = r.notification.request.content.data?.tag;
  return typeof tag === "string" && tag.startsWith("offer:");
}

/** Calls onOfferTap for each tapped offer push, including the one that cold-started the app. Returns the unsubscribe. */
export function watchOfferTaps(src: TapSource, onOfferTap: () => void): () => void {
  let lastId: string | null = null; // the cold-start response may also reach the listener
  const handle = (r: TapResponse) => {
    if (!isOfferTap(r) || r.notification.request.identifier === lastId) return;
    lastId = r.notification.request.identifier;
    onOfferTap();
  };
  const cold = src.getLastNotificationResponse();
  if (cold) {
    src.clearLastNotificationResponse(); // a later remount (sign-out → sign-in) must not replay it
    handle(cold);
  }
  const sub = src.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
