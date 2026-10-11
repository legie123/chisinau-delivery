import { useEffect, useState } from "react";
import { fetchOfferPreview } from "../lib/api";
import type { OfferPreview } from "../lib/offerPreview";

// Sector + total km for the live offer, fetched ONCE per offer id (the offer poll re-reads every
// ~10 s; the preview does not change within an offer's 30 s). It is decoration: on any failure the
// card simply keeps showing what it showed before, so a failed preview never hides an offer.
export function useOfferPreview(offerId: string): OfferPreview | null {
  const [preview, setPreview] = useState<OfferPreview | null>(null);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    fetchOfferPreview(offerId)
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [offerId]);

  return preview;
}
