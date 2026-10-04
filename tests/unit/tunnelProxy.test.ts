import { describe, expect, it } from "vitest";
import { allowedTarget } from "../../scripts/mobile/tunnel-proxy.mjs";

// The phone tunnel must never reach Kong's /pg route (postgres-meta: anonymous SQL as postgres).
// The first version checked the RAW url, so "/rest/v1/../../pg/query" passed the allowlist and
// Kong resolved it to /pg/query — proven live on 2026-10-04 ({"current_user":"postgres"}).
describe("tunnel-proxy allowedTarget", () => {
  it("blocks /pg and every traversal / encoding trick that resolves to it", () => {
    for (const u of [
      "/pg/query",
      "/rest/v1/../../pg/query",
      "/rest/v1/%2e%2e/%2e%2e/pg/query",
      "/rest/v1/%2E%2E/%2E%2E/pg/query",
      "/rest/v1/..%2f..%2fpg/query",
      "/rest/v1%2f..%2f..%2fpg/query",
      "/rest/v1/..\\..\\pg/query",
      "//127.0.0.1:54421/pg/query",
      "/rest/v1/./../../pg/query",
      "/auth/v1/../../pg/query?x=1",
      "/pg/query?/rest/v1/",
      "/project/default",
      "/rest/v2/orders",
      "/restx/v1/orders",
      "rest/v1/orders",
    ]) {
      expect(allowedTarget(u), u).toBeNull();
    }
  });

  it("lets the supabase-js data plane through, normalized", () => {
    expect(allowedTarget("/rest/v1/orders?select=id")).toBe("/rest/v1/orders?select=id");
    expect(allowedTarget("/auth/v1/token?grant_type=password")).toBe("/auth/v1/token?grant_type=password");
    expect(allowedTarget("/realtime/v1/websocket?vsn=1.0.0")).toBe("/realtime/v1/websocket?vsn=1.0.0");
    expect(allowedTarget("/storage/v1/object/public/restaurant-photos/a.jpg")).toBe(
      "/storage/v1/object/public/restaurant-photos/a.jpg",
    );
    expect(allowedTarget("/rest/v1")).toBe("/rest/v1");
    // a harmless dot segment stays inside the data plane after normalization
    expect(allowedTarget("/rest/v1/./orders")).toBe("/rest/v1/orders");
  });
});
