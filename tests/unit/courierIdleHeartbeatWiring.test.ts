import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("web courier idle heartbeat + map tiles", () => {
  it("/deliveries mounts the idle heartbeat only while online and free", () => {
    const page = read("src/app/(courier)/deliveries/page.tsx");
    expect(page).toMatch(/<IdleLocationHeartbeat[^>]*active=\{courier\.status === "online" && active\.length === 0\}/);
  });
  it("the heartbeat feeds the upsert mode (no broadcast without an order)", () => {
    expect(read("src/components/courier/IdleLocationHeartbeat.tsx")).toMatch(/active \? "upsert" : null/);
  });
  it("DeliveryMap no longer uses the dead CARTO tiles and shows attribution", () => {
    const map = read("src/components/shared/DeliveryMap.tsx");
    expect(map).not.toContain("cartocdn");
    expect(map).toContain("tile.openstreetmap.org");
    expect(map).toContain("© OpenStreetMap");
  });
});
