// The kitchen tablet's new-order beep.
// The queue used to build a fresh AudioContext on every beep, from a timer. Chrome starts a
// context made without a user gesture "suspended", so on a tablet nobody had touched the beep
// was silent while the page looked fine. Now one context is created and resumed inside a tap
// ("Activează sunetul"), kept for the page's life, and every beep reuses it. Until then beep()
// returns false and the queue keeps the unlock button on screen instead of failing quietly.

type Ctor = typeof AudioContext;

export function createAlertAudio(getCtor: () => Ctor | undefined) {
  let ctx: AudioContext | null = null;

  const tone = (c: AudioContext) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, c.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.45);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.45);
  };

  return {
    /** Call from a click/tap handler. Plays one short test beep once running. */
    async unlock(): Promise<void> {
      const C = getCtor();
      if (!C) return;
      ctx ??= new C();
      if (ctx.state !== "running") await ctx.resume().catch(() => {});
      if (ctx.state === "running") tone(ctx);
    },
    running(): boolean {
      return ctx?.state === "running";
    },
    /** True if a beep was played; false when sound is not unlocked (never creates a context). */
    beep(): boolean {
      if (!ctx || ctx.state !== "running") return false;
      try {
        tone(ctx);
        return true;
      } catch {
        return false;
      }
    },
  };
}

const browserCtor = () =>
  typeof window === "undefined"
    ? undefined
    : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);

/** One per page: survives router.refresh() and client navigations between partner pages. */
export const kitchenAlertAudio = createAlertAudio(browserCtor);
