import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { offerPreviewLines, previewFor, toOfferPreview } from "../src/lib/offerPreview";

const src = (f: string) => readFileSync(path.join(path.resolve(__dirname, ".."), f), "utf8");

describe("toOfferPreview (offer_preview row -> card model)", () => {
  it("maps a full row, accepting PostgREST numeric strings", () => {
    expect(
      toOfferPreview({ dropoff_sector: "Botanica", pickup_km: "2.40", trip_km: 5, total_km: "7.40" }),
    ).toEqual({ sector: "Botanica", pickupKm: 2.4, tripKm: 5, totalKm: 7.4 });
  });
  it("no row (not the holder / offer no longer live) -> null, not an empty preview", () => {
    expect(toOfferPreview(null)).toBeNull();
    expect(toOfferPreview(undefined)).toBeNull();
  });
  it("keeps unknowns as null; a blank sector is no sector; never turns null into 0", () => {
    expect(toOfferPreview({ dropoff_sector: "  ", pickup_km: null, trip_km: null, total_km: null })).toEqual({
      sector: null,
      pickupKm: null,
      tripKm: null,
      totalKm: null,
    });
    expect(toOfferPreview({ dropoff_sector: "Ciocana", pickup_km: "", trip_km: "x", total_km: null })?.tripKm).toBeNull();
  });
});

describe("offerPreviewLines", () => {
  it("sector and full trip when everything is known", () => {
    expect(offerPreviewLines({ sector: "Botanica", pickupKm: 2.4, tripKm: 5, totalKm: 7.4 })).toEqual([
      "Livrare în Botanica",
      "~7.4 km în total (5.0 km de la restaurant la client)",
    ]);
  });
  it("only the trip leg when the courier distance was unknown (no partial total)", () => {
    expect(offerPreviewLines({ sector: "Ciocana", pickupKm: null, tripKm: 3.26, totalKm: null })).toEqual([
      "Livrare în Ciocana",
      "~3.3 km de la restaurant la client",
    ]);
  });
  it("no sector, no distances -> nothing invented", () => {
    expect(offerPreviewLines({ sector: null, pickupKm: 1, tripKm: null, totalKm: null })).toEqual([]);
    expect(offerPreviewLines(null)).toEqual([]);
  });
});

describe("previewFor (a preview belongs to one offer id)", () => {
  const a = { sector: "Botanica", pickupKm: 1, tripKm: 2, totalKm: 3 };
  it("shows the held preview only for the offer it was fetched for", () => {
    expect(previewFor({ offerId: "A", preview: a }, "A")).toBe(a);
  });
  it("offer A -> B: B shows nothing until its own fetch lands (no stale frame of A)", () => {
    expect(previewFor({ offerId: "A", preview: a }, "B")).toBeNull();
  });
  it("nothing fetched yet, or a fetch that found no row -> null", () => {
    expect(previewFor(null, "A")).toBeNull();
    expect(previewFor({ offerId: "A", preview: null }, "A")).toBeNull();
  });
});

// "Built, never called" guard: the pure helpers are worthless unless the card runs them. The hook
// guards (catch, alive flag, id-keyed read) are checked individually: each one removed must fail.
describe("wiring: the OfferCard really asks for the preview", () => {
  it("api.ts calls the typed RPC wrapper; the card renders the lines; MapScreen passes the offer id", () => {
    expect(src("src/lib/api.ts")).toMatch(/getOfferPreview\(supabase, offerId as OfferId\)/);
    const card = src("src/components/OfferCard.tsx");
    expect(card).toMatch(/useOfferPreview\(offerId\)/);
    expect(card).toMatch(/offerPreviewLines\(preview\)/);
    expect(src("src/screens/MapScreen.tsx")).toMatch(/offerId=\{liveOffer\.offer\.id\}/);
  });
  const hook = () => src("src/hooks/useOfferPreview.ts");
  it("the hook fetches once per offer id", () => {
    expect(hook()).toMatch(/fetchOfferPreview\(offerId\)/);
    expect(hook()).toMatch(/\}, \[offerId\]\);/);
  });
  it("a failed fetch is swallowed (never an unhandled rejection, never a hidden offer)", () => {
    expect(hook()).toMatch(/\.catch\(\(\) => \{\}\)/);
  });
  it("a result landing after unmount or after the id changed is dropped (alive flag + cleanup)", () => {
    expect(hook()).toMatch(/let alive = true;/);
    expect(hook()).toMatch(/if \(alive\) setHeld\(\{ offerId, preview \}\)/);
    expect(hook()).toMatch(/return \(\) => \{\s*alive = false;/);
  });
  it("what the card gets is read through previewFor (keyed by offer id)", () => {
    expect(hook()).toMatch(/return previewFor\(held, offerId\);/);
  });
});
