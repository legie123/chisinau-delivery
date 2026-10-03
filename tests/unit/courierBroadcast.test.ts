import { afterEach, describe, expect, it, vi } from "vitest";
import { trailingThrottle } from "@chisinau/shared-domain";
import { broadcastCourierLocation } from "@/lib/realtime/courierLocation";

afterEach(() => vi.useRealTimers());

describe("trailingThrottle (courier GPS → customer pin)", () => {
  it("sends the first fix at once, then at most one per window", () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const t = trailingThrottle((v: number) => sent.push(v), 10_000);
    t.push(1);
    t.push(2);
    t.push(3);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(9_999);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([1, 3]); // trailing send carries the LATEST fix, not a middle one
  });

  it("a courier who stops still gets the last position out (no stale pin)", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const t = trailingThrottle((v: string) => sent.push(v), 10_000);
    t.push("moving");
    vi.advanceTimersByTime(4_000);
    t.push("stopped-here"); // last fix ever: no further watchPosition callbacks
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual(["moving", "stopped-here"]);
  });

  it("cancel drops the pending send (unmount / order change)", () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const t = trailingThrottle((v: number) => sent.push(v), 10_000);
    t.push(1);
    t.push(2);
    t.cancel();
    vi.advanceTimersByTime(20_000);
    expect(sent).toEqual([1]);
  });
});

describe("broadcastCourierLocation: no send before the private channel joins", () => {
  function fakeSupabase() {
    let onStatus: ((s: string) => void) | null = null;
    const sends: unknown[] = [];
    const channel = {
      subscribe: (cb: (s: string) => void) => {
        onStatus = cb;
        return channel;
      },
      send: (msg: { payload: unknown }) => {
        sends.push(msg.payload);
        return Promise.resolve("ok");
      },
    };
    const supabase = {
      channel: () => channel,
      realtime: { setAuth: () => Promise.resolve() },
      removeChannel: () => Promise.resolve("ok"),
    };
    return { supabase, sends, join: () => onStatus?.("SUBSCRIBED") };
  }

  it("queues only the latest position until SUBSCRIBED, then sends it", () => {
    const f = fakeSupabase();
    const b = broadcastCourierLocation(f.supabase as never, "order-1");
    b.send({ lat: 1, lng: 1 });
    b.send({ lat: 2, lng: 2 });
    expect(f.sends).toEqual([]); // would have gone out over REST before setAuth()
    f.join();
    expect(f.sends).toEqual([{ lat: 2, lng: 2 }]);
    b.send({ lat: 3, lng: 3 });
    expect(f.sends).toEqual([{ lat: 2, lng: 2 }, { lat: 3, lng: 3 }]);
  });
});
