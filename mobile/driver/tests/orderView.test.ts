import { describe, expect, it } from "vitest";
import { addressLines, navUrl, telUrl, toPoint } from "../src/lib/orderView";

describe("toPoint", () => {
  it("passes real coordinates through unchanged", () => {
    expect(toPoint(47.0202637, 28.8294149)).toEqual({ lat: 47.0202637, lng: 28.8294149 });
  });
  it("accepts numeric strings (PostgREST numeric)", () => {
    expect(toPoint("47.01", "28.86")).toEqual({ lat: 47.01, lng: 28.86 });
  });
  it("returns null instead of inventing a point", () => {
    expect(toPoint(null, 28.86)).toBeNull();
    expect(toPoint(47.01, undefined)).toBeNull();
    expect(toPoint("x", "y")).toBeNull();
  });
});

describe("navUrl", () => {
  it("routes to exact coordinates when the pin exists", () => {
    expect(navUrl({ lat: 47.02, lng: 28.83 }, "Str. București 67")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=47.02,28.83",
    );
  });
  it("falls back to the typed address in Chișinău", () => {
    expect(navUrl(null, "Str. București 67")).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("Str. București 67, Chișinău")}`,
    );
  });
  it("has nothing to navigate to without pin or text", () => {
    expect(navUrl(null, "")).toBeNull();
  });
});

describe("telUrl", () => {
  it("strips spaces, keeps the plus", () => {
    expect(telUrl("+373 69 123 456")).toBe("tel:+37369123456");
  });
  it("is null for an empty phone", () => {
    expect(telUrl(null)).toBeNull();
    expect(telUrl("  ")).toBeNull();
  });
});

describe("addressLines", () => {
  it("joins street and every door detail the courier needs", () => {
    expect(
      addressLines({
        street_address: "Str. Ismail 88",
        building: "4",
        entrance: "2",
        floor: "5",
        apartment: "12",
        intercom_code: "25K",
      }),
    ).toEqual({ street: "Str. Ismail 88", door: "bloc 4, scara 2, etaj 5, ap. 12, interfon 25K" });
  });
  it("omits missing parts", () => {
    expect(addressLines({ street_address: "Str. Ismail 88" })).toEqual({ street: "Str. Ismail 88", door: "" });
  });
});
