import { afterEach, describe, expect, it } from "vitest";
import { appOrigin, foreignRedirect, isSharedPath, ownerOf } from "@/lib/apps/registry";

describe("ownerOf — path ownership across the 4 apps", () => {
  it("segment-bounded: /restaurant vs /restaurants vs /start/restaurant", () => {
    expect(ownerOf("/restaurant/orders")).toBe("restaurant");
    expect(ownerOf("/restaurant")).toBe("restaurant");
    expect(ownerOf("/restaurants")).toBe("client");
    expect(ownerOf("/restaurants/sakura")).toBe("client");
    expect(ownerOf("/start/restaurant")).toBe("client");
  });

  it("courier owns /deliveries/* and exactly /earnings", () => {
    expect(ownerOf("/deliveries")).toBe("curier");
    expect(ownerOf("/deliveries/history")).toBe("curier");
    expect(ownerOf("/earnings")).toBe("curier");
    expect(ownerOf("/earningsx")).toBe("client");
  });

  it("master owns /platform, /master and /api/platform", () => {
    expect(ownerOf("/platform")).toBe("master");
    expect(ownerOf("/platform/orders/abc")).toBe("master");
    expect(ownerOf("/master/enter/curier")).toBe("master");
    expect(ownerOf("/api/platform/ai")).toBe("master");
  });

  it("everything else is the client's", () => {
    for (const p of ["/", "/cart", "/checkout", "/orders/1", "/concierge/rezervari", "/catering", "/cum-functioneaza"]) {
      expect(ownerOf(p), p).toBe("client");
    }
  });
});

describe("isSharedPath — served by every app, never redirected", () => {
  it("auth, shared api, pwa plumbing", () => {
    for (const p of ["/login", "/enter/curier", "/api/route", "/api/menu-search", "/sw.js", "/manifest.webmanifest", "/_next/static/x.js", "/icon-192.png", "/videos/hero-courier.mp4"]) {
      expect(isSharedPath(p), p).toBe(true);
    }
    expect(isSharedPath("/api/platform/ai")).toBe(false);
    expect(isSharedPath("/loginx")).toBe(false);
  });
});

describe("appOrigin / foreignRedirect — keep the hostname, swap only the port", () => {
  const saved = process.env.APP_ORIGIN_CURIER;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_ORIGIN_CURIER;
    else process.env.APP_ORIGIN_CURIER = saved;
  });

  it("localhost stays localhost, 127.0.0.1 stays 127.0.0.1 (cookie jar is per host)", () => {
    delete process.env.APP_ORIGIN_CURIER;
    expect(appOrigin("curier", "localhost:3001")).toBe("http://localhost:3002");
    expect(appOrigin("curier", "127.0.0.1:3001")).toBe("http://127.0.0.1:3002");
    expect(appOrigin("master", null)).toBe("http://localhost:3004");
  });

  it("env override wins (production domains)", () => {
    process.env.APP_ORIGIN_CURIER = "https://curier.example.md/";
    expect(appOrigin("curier", "localhost:3001")).toBe("https://curier.example.md");
  });

  it("redirects a foreign path with path+search, never an owned or shared one", () => {
    delete process.env.APP_ORIGIN_CURIER;
    const u = (pathname: string, search = "") => ({ pathname, search, protocol: "http:" });
    expect(foreignRedirect("client", u("/deliveries", "?x=1"), "localhost:3001")).toBe("http://localhost:3002/deliveries?x=1");
    expect(foreignRedirect("client", u("/restaurants"), "localhost:3001")).toBeNull();
    expect(foreignRedirect("curier", u("/login", "?next=/deliveries"), "localhost:3002")).toBeNull();
    expect(foreignRedirect("curier", u("/"), "localhost:3002")).toBe("http://localhost:3001/");
    expect(foreignRedirect("restaurant", u("/restaurants"), "localhost:3003")).toBe("http://localhost:3001/restaurants");
  });
});
