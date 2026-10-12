// Handover check at the counter: the kitchen asks the courier for the order's pickup code
// and hands the bag over only on a match. Code = last 3 digits of the order number
// (every order number is CHD-YYYY-NNNNNN, checked 2026-10-12). The courier app must show
// the same rule (CURIER, see CROSS-REQUESTS).
// ponytail: 3 digits → two waiting orders at one counter collide 1 time in 1000; use 4 if it bites.
export function pickupCode(orderNumber: string): string | null {
  const m = /(\d{3})$/.exec(orderNumber.trim());
  return m ? m[1] : null;
}
