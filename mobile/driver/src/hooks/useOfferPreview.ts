import { useEffect, useState } from "react";
import { fetchOfferPreview } from "../lib/api";
import { previewFor, type OfferPreview } from "../lib/offerPreview";

// Sector + total km for the live offer, fetched ONCE per offer id (the offer poll re-reads every
// ~10 s; the preview does not change within an offer's 30 s). It is decoration: on any failure the
// card simply keeps showing what it showed before, so a failed preview never hides an offer.
// The result is stored WITH its offer id and read through previewFor, so a late or stale result
// for another offer is never shown.
export function useOfferPreview(offerId: string): OfferPreview | null {
  const [held, setHeld] = useState<{ offerId: string; preview: OfferPreview | null } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchOfferPreview(offerId)
      .then((preview) => {
        if (alive) setHeld({ offerId, preview });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [offerId]);

  return previewFor(held, offerId);
}
