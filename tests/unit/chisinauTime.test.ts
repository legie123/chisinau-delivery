import { describe, expect, it } from "vitest";
import { chisinauLocalToIso } from "@/lib/admin/chisinauTime";

describe("chisinauLocalToIso", () => {
  it("summer time is UTC+3", () => {
    expect(chisinauLocalToIso("2026-07-15T10:00")).toBe("2026-07-15T07:00:00.000Z");
  });
  it("winter time is UTC+2", () => {
    expect(chisinauLocalToIso("2026-12-15T10:00")).toBe("2026-12-15T08:00:00.000Z");
  });
  it("handles the day of the October switch (25.10.2026, 04:00 -> 03:00)", () => {
    expect(chisinauLocalToIso("2026-10-25T12:00")).toBe("2026-10-25T10:00:00.000Z");
    expect(chisinauLocalToIso("2026-10-24T12:00")).toBe("2026-10-24T09:00:00.000Z");
  });
  it("returns null for empty or malformed input", () => {
    expect(chisinauLocalToIso("")).toBeNull();
    expect(chisinauLocalToIso("mâine")).toBeNull();
    expect(chisinauLocalToIso("2026-13-40T99:99")).toBeNull();
  });
});
