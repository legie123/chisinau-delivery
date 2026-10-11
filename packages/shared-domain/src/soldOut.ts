// "Epuizat" (menu_items.sold_out_until, set from the kitchen tablet). Same rule as place_order
// (20261012000102): sold out while sold_out_until is later than now. PostgREST returns the
// "until switched back" value as the string "infinity". Used by the web menu and mobile/client.
export function isSoldOut(until: string | null | undefined, now = Date.now()): boolean {
  if (!until) return false;
  if (until === "infinity") return true;
  const t = Date.parse(until);
  return Number.isFinite(t) && t > now;
}
