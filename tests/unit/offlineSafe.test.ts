import { describe, expect, it } from "vitest";
import { OFFLINE_MESSAGE, offlineSafe } from "@/lib/kitchen/offlineSafe";

describe("offlineSafe", () => {
  it("passes the action's own result through", async () => {
    expect(await offlineSafe(async () => ({ error: null }))).toEqual({ error: null });
    expect(await offlineSafe(async () => ({ error: "x" }))).toEqual({ error: "x" });
  });
  it("turns a network failure into a message instead of a thrown error", async () => {
    await expect(offlineSafe(() => Promise.reject(new TypeError("Failed to fetch")))).resolves.toEqual({ error: OFFLINE_MESSAGE });
  });
});
