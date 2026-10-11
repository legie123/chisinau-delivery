import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../app.config";
import { proofPath } from "../src/lib/deliveryProof";

const src = (f: string) => readFileSync(path.join(path.resolve(__dirname, ".."), f), "utf8");

describe("proofPath (storage RLS + attach_delivery_proof both key on the FIRST segment = order id)", () => {
  it("puts the photo under the order's own folder as a .jpg", () => {
    expect(proofPath("2d3c0e8a-1111-4222-8333-444455556666", 1760000000000, "abc123")).toBe(
      "2d3c0e8a-1111-4222-8333-444455556666/1760000000000-abc123.jpg",
    );
  });
  it("matches the RPC's own check ^<order_id>/", () => {
    const id = "2d3c0e8a-1111-4222-8333-444455556666";
    expect(new RegExp(`^${id}/`).test(proofPath(id, 1, "x"))).toBe(true);
  });
  it("never lets a stray slash in the random part create a second folder level", () => {
    expect(proofPath("o", 1, "a/b").split("/")).toHaveLength(2);
  });
});

describe("camera permission: camera only, Romanian text, no microphone, no photo library", () => {
  const plugin = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === "expo-image-picker") as
    | [string, Record<string, unknown>]
    | undefined;
  it("expo-image-picker is configured", () => {
    expect(plugin).toBeDefined();
  });
  it("asks for the camera in Romanian and blocks microphone + photo library", () => {
    expect(String(plugin?.[1].cameraPermission)).toMatch(/fotografi|poz/i);
    expect(plugin?.[1].microphonePermission).toBe(false);
    expect(plugin?.[1].photosPermission).toBe(false);
  });
});

describe("wiring: the delivery screen really uploads and attaches the photo", () => {
  it("api.ts uploads under proofPath and then calls attachDeliveryProof with that same path", () => {
    const s = src("src/lib/api.ts");
    expect(s).toMatch(/const path = proofPath\(orderId, Date\.now\(\)/);
    expect(s).toMatch(/\.from\("delivery-proof"\)\.upload\(path,/);
    expect(s).toMatch(/attachDeliveryProof\(supabase, orderId as OrderId, path\)/);
  });
  it("ActiveDeliveryScreen takes a CAMERA photo (not the library) and sends it through uploadDeliveryProof", () => {
    const s = src("src/screens/ActiveDeliveryScreen.tsx");
    expect(s).toMatch(/launchCameraAsync\(/);
    expect(s).not.toMatch(/launchImageLibraryAsync/);
    expect(s).toMatch(/uploadDeliveryProof\(order\.id, shot\.assets\[0\]\.uri\)/);
  });
});
