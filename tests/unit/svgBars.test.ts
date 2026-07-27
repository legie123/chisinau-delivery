import { describe, expect, it } from "vitest";
import { barSlot, scaleToPixels } from "@/components/charts/SvgBars";

describe("scaleToPixels", () => {
  it("scales a value proportionally to the track size", () => {
    expect(scaleToPixels(50, 100, 200)).toBe(100);
    expect(scaleToPixels(100, 100, 200)).toBe(200);
    expect(scaleToPixels(0, 100, 200)).toBe(0);
  });

  it("guards against a zero/negative max so an all-empty dataset never NaNs", () => {
    expect(scaleToPixels(0, 0, 200)).toBe(0);
    expect(scaleToPixels(5, -1, 200)).toBe(0);
  });

  it("guards against a zero/negative track size", () => {
    expect(scaleToPixels(50, 100, 0)).toBe(0);
    expect(scaleToPixels(50, 100, -10)).toBe(0);
  });

  it("clamps a value above max instead of overflowing the track", () => {
    expect(scaleToPixels(150, 100, 200)).toBe(200);
  });

  it("clamps a negative value to zero", () => {
    expect(scaleToPixels(-20, 100, 200)).toBe(0);
  });
});

describe("barSlot", () => {
  it("divides the track into `count` even slots separated by the gap", () => {
    // 4 bars, 100px track, 4px gap -> size = (100 - 3*4) / 4 = 22
    expect(barSlot(0, 4, 100, 4)).toEqual({ start: 0, size: 22 });
    expect(barSlot(1, 4, 100, 4)).toEqual({ start: 26, size: 22 });
    expect(barSlot(3, 4, 100, 4)).toEqual({ start: 78, size: 22 });
  });

  it("covers the full 24-bar hourly histogram without negative sizes", () => {
    const trackPx = 624; // 640 width - 8 left - 8 right
    for (let i = 0; i < 24; i++) {
      const { start, size } = barSlot(i, 24, trackPx, 4);
      expect(size).toBeGreaterThan(0);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start + size).toBeLessThanOrEqual(trackPx + 0.001);
    }
  });

  it("returns a zero slot for an empty dataset instead of dividing by zero", () => {
    expect(barSlot(0, 0, 200, 4)).toEqual({ start: 0, size: 0 });
  });
});
