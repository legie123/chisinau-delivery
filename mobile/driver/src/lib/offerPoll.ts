// Offer poll fallback while the courier is online. Realtime is the fast path,
// but a websocket that silently died (tunnel, OS-suspended socket, carrier NAT)
// must not cost the courier a 30s offer — so the app ALSO polls.
//
// Cadence: BASE ± JITTER (self-rescheduling setTimeout, not setInterval), so a
// fleet that reconnects after the same network blip doesn't hit Supabase in
// lock-step. One failure doubles the next delay ONCE (never more: an offer lives
// 30s, a long backoff would turn the fallback into a no-op). Pure: timers and
// randomness are injected so the schedule is unit-tested.

export const OFFER_POLL_BASE_MS = 10_000;
export const OFFER_POLL_JITTER_MS = 2_000;

export type PollDeps = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  random: () => number; // [0, 1)
};

const defaultDeps: PollDeps = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  random: Math.random,
};

export function nextPollDelay(failed: boolean, random: () => number): number {
  const jitter = (random() * 2 - 1) * OFFER_POLL_JITTER_MS; // uniform in [-J, +J)
  return Math.round(OFFER_POLL_BASE_MS * (failed ? 2 : 1) + jitter);
}

export function startOfferPoll(task: () => Promise<void>, deps: PollDeps = defaultDeps): { stop: () => void } {
  let stopped = false;
  let handle: unknown = null;

  const schedule = (failed: boolean) => {
    if (stopped) return;
    handle = deps.setTimeout(tick, nextPollDelay(failed, deps.random));
  };

  async function tick() {
    if (stopped) return;
    let failed = false;
    try {
      await task();
    } catch {
      failed = true; // surfaced by the task's own error state; here it only slows the next tick
    }
    schedule(failed);
  }

  schedule(false);
  return {
    stop() {
      stopped = true;
      if (handle != null) deps.clearTimeout(handle);
    },
  };
}
