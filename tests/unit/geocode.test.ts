import { afterEach, describe, expect, it, vi } from "vitest";

const { geocodeAddress } = await import("@/lib/geo/geocode");

function mockFetch(impl: () => Promise<Partial<Response>> | Partial<Response>) {
  vi.stubGlobal("fetch", vi.fn(async () => impl() as unknown as Response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("geocodeAddress — Nominatim onboarding geocoder", () => {
  it("parses a valid Chișinău hit into lat/lng", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => [{ lat: "47.0202637", lon: "28.8294149", display_name: "67, Strada București, Chișinău" }],
    }));
    const res = await geocodeAddress("Strada București 67");
    expect(res).toEqual({ lat: 47.0202637, lng: 28.8294149, displayName: "67, Strada București, Chișinău" });
  });

  it("returns null when Nominatim finds nothing", async () => {
    mockFetch(() => ({ ok: true, json: async () => [] }));
    expect(await geocodeAddress("Str. Inexistentă 99999")).toBeNull();
  });

  it("rejects a hit outside Moldova bounds (geocoder miss)", async () => {
    // Paris — well outside the Moldova clamp; must not become a restaurant position.
    mockFetch(() => ({ ok: true, json: async () => [{ lat: "48.8566", lon: "2.3522", display_name: "Paris" }] }));
    expect(await geocodeAddress("Somewhere ambiguous")).toBeNull();
  });

  it("returns null on a non-OK HTTP response", async () => {
    mockFetch(() => ({ ok: false, json: async () => [] }));
    expect(await geocodeAddress("Strada București 67")).toBeNull();
  });

  it("returns null (never throws) on a network failure — geocoding must not block onboarding", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(geocodeAddress("Strada București 67")).resolves.toBeNull();
  });

  it("returns null when coordinates are non-numeric", async () => {
    mockFetch(() => ({ ok: true, json: async () => [{ lat: "n/a", lon: "n/a", display_name: "x" }] }));
    expect(await geocodeAddress("Strada București 67")).toBeNull();
  });
});
