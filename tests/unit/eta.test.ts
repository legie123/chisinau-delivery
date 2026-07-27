import { afterEach, describe, expect, it, vi } from "vitest";
import { DELIVERY_BUFFER_MIN, formatPrepRange, formatClock, minutesUntil } from "@/lib/orders/eta";

describe("formatPrepRange", () => {
  it("shows prep..prep+buffer with the en-dash and 'min'", () => {
    expect(formatPrepRange(25)).toBe(`25–${25 + DELIVERY_BUFFER_MIN} min`);
    expect(formatPrepRange(30)).toBe(`30–${30 + DELIVERY_BUFFER_MIN} min`);
  });

  it("rounds fractional minutes to the nearest whole", () => {
    expect(formatPrepRange(24.6)).toBe(`25–${25 + DELIVERY_BUFFER_MIN} min`);
    expect(formatPrepRange(24.2)).toBe(`24–${24 + DELIVERY_BUFFER_MIN} min`);
  });

  it("never shows a low bound below 1 min", () => {
    expect(formatPrepRange(0)).toBe(`1–${1 + DELIVERY_BUFFER_MIN} min`);
  });

  it("uses p90 as the upper bound when it's meaningfully above the average", () => {
    expect(formatPrepRange({ prep_minutes: 25, p90_prep_minutes: 45 })).toBe("25–45 min");
  });

  it("floors the spread instead of a near-zero-width range when p90 barely exceeds the average", () => {
    expect(formatPrepRange({ prep_minutes: 25, p90_prep_minutes: 26 })).toBe("25–30 min");
  });

  it("falls back to the fixed buffer when p90 is null (no sample yet)", () => {
    expect(formatPrepRange({ prep_minutes: 25, p90_prep_minutes: null })).toBe(
      `25–${25 + DELIVERY_BUFFER_MIN} min`,
    );
  });

  it("falls back to the fixed buffer when p90 is at or below the average (bad data guard)", () => {
    expect(formatPrepRange({ prep_minutes: 25, p90_prep_minutes: 25 })).toBe(
      `25–${25 + DELIVERY_BUFFER_MIN} min`,
    );
  });
});

describe("minutesUntil", () => {
  afterEach(() => vi.useRealTimers());

  it("is positive for a future instant, negative once past due", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));
    expect(minutesUntil("2026-07-17T12:10:00Z")).toBe(10);
    expect(minutesUntil("2026-07-17T11:55:00Z")).toBe(-5);
    expect(minutesUntil("2026-07-17T12:00:00Z")).toBe(0);
  });
});

describe("formatClock", () => {
  it("renders a two-digit HH:MM clock", () => {
    expect(formatClock("2026-07-17T09:05:00Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
