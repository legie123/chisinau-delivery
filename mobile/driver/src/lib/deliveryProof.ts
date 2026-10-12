// Proof-of-delivery photo path in the private 'delivery-proof' bucket. The FIRST segment must be the
// order id: the storage insert policy (delivery_proof_courier_write) and attach_delivery_proof's
// `^<order_id>/` check both key on it. Pure so vitest can run it.
export function proofPath(orderId: string, now: number, rand: string): string {
  return `${orderId}/${now}-${rand.replace(/[^a-z0-9]/gi, "")}.jpg`;
}
