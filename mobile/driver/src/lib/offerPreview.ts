// What the courier may know about a live offer before accepting it: the drop-off SECTOR and the
// distances (offer_preview RPC). The street and coordinates stay hidden until assignment.
// Pure on purpose (no supabase import) so vitest can run it.

export interface OfferPreview {
  sector: string | null;
  pickupKm: number | null; // courier -> restaurant (null when the courier had no fresh position)
  tripKm: number | null; // restaurant -> customer (null when the order has no drop-off pin)
  totalKm: number | null; // only when BOTH legs are known
}

export interface OfferPreviewRow {
  dropoff_sector: string | null;
  pickup_km: number | string | null;
  trip_km: number | string | null;
  total_km: number | string | null;
}

// PostgREST returns numeric as number or string; blank / non-numeric is unknown, never 0.
function km(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** null = no row: not the holder, or the offer is no longer live. */
export function toOfferPreview(row: OfferPreviewRow | null | undefined): OfferPreview | null {
  if (!row) return null;
  const sector = row.dropoff_sector?.trim() || null;
  return { sector, pickupKm: km(row.pickup_km), tripKm: km(row.trip_km), totalKm: km(row.total_km) };
}

/** Extra lines under the pickup distance on the OfferCard. Shows only what the server knew. */
export function offerPreviewLines(p: OfferPreview | null): string[] {
  if (!p) return [];
  const lines: string[] = [];
  if (p.sector) lines.push(`Livrare în ${p.sector}`);
  if (p.totalKm != null && p.tripKm != null) {
    lines.push(`~${p.totalKm.toFixed(1)} km în total (${p.tripKm.toFixed(1)} km de la restaurant la client)`);
  } else if (p.tripKm != null) {
    lines.push(`~${p.tripKm.toFixed(1)} km de la restaurant la client`);
  }
  return lines;
}

/**
 * The preview belongs to ONE offer id. If the card switches from offer A to B without unmounting, the
 * first render of B must not show A's sector and km (the fetch for B has not landed yet).
 */
export function previewFor(
  held: { offerId: string; preview: OfferPreview | null } | null,
  offerId: string,
): OfferPreview | null {
  return held && held.offerId === offerId ? held.preview : null;
}
