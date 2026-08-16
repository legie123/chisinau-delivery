import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DELIVERY_BUFFER_MIN,
  formatPrepRange,
  formatClock,
  formatTargetClock,
  minutesUntil,
} from "@/lib/orders/eta";

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

// V2 buclă de noapte: de când accept_order ancorează ținta comenzii programate
// de fereastra cerută (migrația 20260816000000), ținta poate cădea legitim
// mâine. O oră goală, „09:15", citită la 22:00 înseamnă acum unsprezece ore, nu
// acum patruzeci de minute — deci ziua se scrie când nu e azi.
describe("formatTargetClock", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the bare clock when the target is the same Chișinău day", () => {
    const now = new Date("2026-08-16T09:00:00Z").getTime();
    expect(formatTargetClock("2026-08-16T18:30:00Z", now)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("adds the day when the target is not today", () => {
    const now = new Date("2026-08-16T19:00:00Z").getTime();
    const out = formatTargetClock("2026-08-17T06:15:00Z", now);
    expect(out).not.toMatch(/^\d{2}:\d{2}$/);
    expect(out).toContain("17");
  });

  it("uses the Chișinău day boundary, not UTC's", () => {
    // 21:30 UTC = 00:30 local NEXT day (UTC+3) — a UTC-based comparison would
    // call this "today" and drop the date the reader needs.
    const now = new Date("2026-08-16T12:00:00Z").getTime();
    expect(formatTargetClock("2026-08-16T21:30:00Z", now)).not.toMatch(/^\d{2}:\d{2}$/);
  });
});
