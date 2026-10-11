import { describe, expect, it, vi } from "vitest";
import { createAlertAudio } from "@/lib/kitchen/alertAudio";

// A fake AudioContext: starts suspended (Chrome autoplay policy without a gesture),
// resume() makes it running. Counts constructions and oscillator starts.
function fakeAudio() {
  const made: FakeCtx[] = [];
  class FakeCtx {
    state: "suspended" | "running" | "closed" = "suspended";
    currentTime = 0;
    destination = {};
    starts = 0;
    constructor() {
      made.push(this);
    }
    resume = vi.fn(async () => {
      this.state = "running";
    });
    createOscillator = () => {
      const node = { type: "", frequency: { value: 0 }, connect: (n: unknown) => n, start: () => this.starts++, stop: () => {} };
      return node;
    };
    createGain = () => ({
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: (n: unknown) => n,
    });
  }
  return { Ctor: FakeCtx as unknown as typeof AudioContext, made };
}

describe("alert audio", () => {
  it("does not create a context (or pretend to beep) before the kitchen unlocks it", () => {
    const { Ctor, made } = fakeAudio();
    const audio = createAlertAudio(() => Ctor);
    expect(audio.beep()).toBe(false);
    expect(made.length).toBe(0);
    expect(audio.running()).toBe(false);
  });

  it("unlock creates one context and resumes it", async () => {
    const { Ctor, made } = fakeAudio();
    const audio = createAlertAudio(() => Ctor);
    await audio.unlock();
    expect(made.length).toBe(1);
    expect(made[0].resume).toHaveBeenCalled();
    expect(audio.running()).toBe(true);
  });

  it("every beep reuses the unlocked context instead of making a new suspended one", async () => {
    const { Ctor, made } = fakeAudio();
    const audio = createAlertAudio(() => Ctor);
    await audio.unlock();
    expect(audio.beep()).toBe(true);
    expect(audio.beep()).toBe(true);
    expect(audio.beep()).toBe(true);
    expect(made.length).toBe(1);
    expect(made[0].starts).toBe(4); // unlock plays one test beep + 3 alerts
  });

  it("reports not running when the browser suspends the context again", async () => {
    const { Ctor, made } = fakeAudio();
    const audio = createAlertAudio(() => Ctor);
    await audio.unlock();
    made[0].state = "suspended";
    expect(audio.running()).toBe(false);
    expect(audio.beep()).toBe(false);
  });

  it("is a no-op without Web Audio support", async () => {
    const audio = createAlertAudio(() => undefined);
    await audio.unlock();
    expect(audio.running()).toBe(false);
    expect(audio.beep()).toBe(false);
  });
});
