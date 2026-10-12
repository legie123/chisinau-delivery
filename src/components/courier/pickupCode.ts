// Handover code the kitchen asks for at the counter — RESTAURANT's rule (src/lib/kitchen/pickupCode.ts on
// sector/restaurant), copied for the web courier until it lands on main; the driver app has the same copy
// (mobile/driver/src/lib/orderView.ts, guarded by mobile/driver/tests/pickupCode.test.ts).
// Last 3 digits of the order number (every order number is CHD-YYYY-NNNNNN); null = no code.
export function pickupCode(orderNumber: string): string | null {
  const m = /(\d{3})$/.exec(orderNumber.trim());
  return m ? m[1] : null;
}
