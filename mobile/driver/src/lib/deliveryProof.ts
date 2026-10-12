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

/**
 * The whole "Fă o poză la livrare" flow with its effects injected, so it is tested for what it does:
 * no permission -> told, no camera; cancelled -> nothing; upload failure -> told, NOT marked saved;
 * the sending flag always goes back to false.
 */
export async function takeProofPhoto(
  orderId: string,
  deps: {
    requestCamera: () => Promise<{ granted: boolean }>;
    launchCamera: (options: typeof CAMERA_OPTIONS) => Promise<{ canceled: boolean; assets: { uri: string }[] | null }>;
    upload: (orderId: string, uri: string) => Promise<string | null>;
    alert: (title: string, text: string) => void;
    setSending: (on: boolean) => void;
    setSaved: (saved: boolean) => void;
  },
): Promise<void> {
  const perm = await deps.requestCamera();
  if (!perm.granted) {
    deps.alert("Camera nu e permisă", "Permite accesul la cameră din setările telefonului ca să faci poza la livrare.");
    return;
  }
  const shot = await deps.launchCamera(CAMERA_OPTIONS);
  if (shot.canceled || !shot.assets || shot.assets.length === 0) return;
  deps.setSending(true);
  let err: string | null;
  try {
    err = await deps.upload(orderId, shot.assets[0].uri);
  } finally {
    deps.setSending(false);
  }
  if (err) {
    deps.alert("Poza nu s-a salvat", err);
    return;
  }
  deps.setSaved(true);
}
