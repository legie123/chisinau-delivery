// Randomized exponential-backoff poll scheduler.
//
// Every realtime-degraded surface used to fall back to a bare `setInterval(fn,
// 30_000)`. When many courier/admin tabs degrade around the same time (a
// shared network blip), they all resume polling on the exact same 30s phase
// forever — a synchronized thundering herd against Supabase. This schedules
// each tick with jitter (base ± 0-10s) via a self-rescheduling `setTimeout`
// (not `setInterval`, so the cadence can actually change between ticks) and
// backs off exponentially (capped) while `task` keeps failing, so a courier
// stuck in a dead zone doesn't hammer the network every 30s regardless.

const BASE_MS = 30_000;
const JITTER_MS = 10_000;
const MAX_BACKOFF_MULTIPLIER = 8; // caps backoff at 8x base (4 min)

function jitteredDelay(consecutiveFailures: number): number {
  const backoff = Math.min(2 ** consecutiveFailures, MAX_BACKOFF_MULTIPLIER);
  return BASE_MS * backoff + Math.random() * JITTER_MS;
}

export type JitteredPoll = { stop: () => void };

// `task` resolving/returning normally counts as success (resets backoff);
// throwing (or a rejected promise) counts as a failure and pushes the next
// tick further out.
export function startJitteredPoll(task: () => void | Promise<void>): JitteredPoll {
  let stopped = false;
  let consecutiveFailures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (stopped) return;
    try {
      await task();
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures += 1;
    }
    if (stopped) return;
    timer = setTimeout(tick, jitteredDelay(consecutiveFailures));
  }

  timer = setTimeout(tick, jitteredDelay(0));

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
