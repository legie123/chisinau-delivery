// Proof-of-delivery photo path in the private 'delivery-proof' bucket. The FIRST segment must be the
// order id: the storage insert policy (delivery_proof_courier_write) and attach_delivery_proof's
// `^<order_id>/` check both key on it. Pure so vitest can run it.
export function proofPath(orderId: string, now: number, rand: string): string {
  return `${orderId}/${now}-${rand.replace(/[^a-z0-9]/gi, "")}.jpg`;
}

/** Camera options for the proof photo: JPEG re-encoded at 0.4, no editing, EXIF not handed to JS. */
export const CAMERA_OPTIONS = { mediaTypes: ["images"] as ("images")[], quality: 0.4, allowsEditing: false, exif: false };

/** The proof button exists only on the delivery leg (attach_delivery_proof accepts en_route / <= 1 h after). */
export function proofButtonVisible(step: "pickup" | "delivering" | "delivered"): boolean {
  return step === "delivering";
}
