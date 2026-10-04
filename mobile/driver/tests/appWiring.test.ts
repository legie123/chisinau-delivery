import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../app.config";

// Wiring that lives in React components / build config (no RN runtime here):
// asserted on the source and on the resolved config object.
const root = path.resolve(__dirname, "..");
const src = (f: string) => readFileSync(path.join(root, f), "utf8");

describe("tab screens refresh on focus (MED: bottom tabs stay mounted)", () => {
  for (const f of ["src/screens/EarningsScreen.tsx", "src/screens/ProfileScreen.tsx"]) {
    it(`${f} loads in useFocusEffect, not a mount-once useEffect`, () => {
      const s = src(f);
      expect(s).toMatch(/useFocusEffect\(\s*useCallback\(/);
      expect(s).not.toMatch(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/);
    });
  }
});

describe("GPS privacy wiring (MED)", () => {
  it("MapScreen never starts tracking on accept/claim; only for a picked_up/en_route order", () => {
    const s = src("src/screens/MapScreen.tsx");
    expect(s).not.toMatch(/beginTracking/);
    expect(s).toMatch(/BROADCAST_STATUSES\.includes\(activeDelivery\.status\)/);
    expect(s).toMatch(/resumeDeliveryTracking\(\)/); // LOW: Android background start retried on foreground
  });

  it("ActiveDelivery starts at pickup and stops on 'am livrat' even when it was queued offline", () => {
    const s = src("src/screens/ActiveDeliveryScreen.tsx");
    expect(s).not.toMatch(/if \(!queued\) \{\s*stopDeliveryTracking/);
    expect(s).toMatch(/setStatus\('delivered'\);[\s\S]{0,200}void stopGps\(\);/);
    expect(s).toMatch(/setStatus\('delivering'\);\s*startGps\(\);/);
    expect(s).toMatch(/const broadcasting = status === 'delivering';/);
  });
});

describe("offline banner dismiss clears only what it showed", () => {
  it("useOfflineSync passes the shown count to clearGiveUpCount", () => {
    expect(src("src/hooks/useOfflineSync.ts")).toMatch(/clearGiveUpCount\(givenUp\)/);
  });
});

describe("build / dev loop", () => {
  it("expo-secure-store does not add an English Face ID prompt (LOW f)", () => {
    expect(config.plugins).toContainEqual(["expo-secure-store", { faceIDPermission: false }]);
    expect(config.plugins).not.toContain("expo-secure-store");
  });

  it("the committed development profile (developmentClient) has expo-dev-client to run (LOW)", () => {
    const eas = JSON.parse(src("eas.json"));
    expect(eas.build.development.developmentClient).toBe(true);
    const pkg = JSON.parse(src("package.json"));
    expect(pkg.dependencies["expo-dev-client"]).toBeTruthy();
    const lock = JSON.parse(src("package-lock.json"));
    expect(lock.packages["node_modules/expo-dev-client"]).toBeTruthy();
  });

  it("dev.sh starts Metro with --clear (stale EXPO_PUBLIC_* in the transform cache, LOW)", () => {
    const dev = readFileSync(path.resolve(root, "../../scripts/mobile/dev.sh"), "utf8");
    expect(dev).toMatch(/expo start --dev-client --clear/);
  });
});
