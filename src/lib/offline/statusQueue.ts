// Minimal offline queue for courier status changes (advance_delivery_status).
//
// A courier loses signal in a stairwell / dead zone, taps "Am ridicat" / "Am
// livrat" — the Server Action call fails and the update would otherwise be
// lost, leaving the order looking stuck to everyone. This persists the
// intended transition in localStorage and replays it once connectivity
// returns.
//
// advance_delivery_status is idempotent (a call with the order already in
// the target status just returns), so re-sending a resolved entry is
// harmless. An entry whose transition is no longer valid — RPC raises
// "invalid transition X -> Y", e.g. another device already advanced the
// order — is dropped rather than retried forever.

const STORAGE_KEY = "chisinau-courier-pending-status";
const GIVEUP_STORAGE_KEY = "chisinau-courier-giveup-count";

// A dead zone that lasts hours (tunnel, rural delivery, phone off) shouldn't
// leave an entry retrying forever — cap both its age and its attempt count.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export type PendingStatusChange = {
  orderId: string;
  newStatus: string;
  paymentConfirmed?: boolean;
  // Caller-supplied tap timestamp — used for display/ordering only, NOT
  // trusted for the 24h staleness check (tests and some callers use it as a
  // plain sequence number, not real wall-clock time). See `enqueuedAt`.
  ts: number;
  // Real wall-clock moment this entry entered the queue — stamped with
  // `Date.now()` by `enqueueStatusChange` regardless of `ts`. Optional only
  // so already-persisted entries from before this field existed decode fine
  // (isStuck falls back to `ts` for those).
  enqueuedAt?: number;
  // Drain attempts so far for this entry. Optional, defaults to 0.
  attempts?: number;
};

export type AdvanceFn = (
  orderId: string,
  newStatus: string,
  paymentConfirmed?: boolean,
) => Promise<{ error: string | null }>;

// `localStorage` (not `window.localStorage`) so this also works under a
// stubbed global in tests; `typeof` never throws even when undeclared, which
// is what keeps this safe during SSR where no such global exists.
function hasStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export function readPendingQueue(): PendingStatusChange[] {
  if (!hasStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingQueue(queue: PendingStatusChange[]): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Storage full/unavailable (private mode) — queue is best-effort, drop silently.
  }
}

// One pending entry per order — a newer tap supersedes an older, unsent one
// (and restarts its age/attempts clock — it's a fresh intended transition).
export function enqueueStatusChange(entry: PendingStatusChange): void {
  const queue = readPendingQueue().filter((e) => e.orderId !== entry.orderId);
  queue.push({ ...entry, enqueuedAt: entry.enqueuedAt ?? Date.now(), attempts: entry.attempts ?? 0 });
  writePendingQueue(queue);
}

export function hasPendingChange(orderId: string): boolean {
  return readPendingQueue().some((e) => e.orderId === orderId);
}

// Total pending changes across ALL orders — drives the app-level "N acțiuni în
// așteptare" banner in the courier layout (not order-scoped like hasPendingChange).
export function pendingQueueCount(): number {
  return readPendingQueue().length;
}

function isInvalidTransitionError(message: string | null): boolean {
  return !!message && message.includes("invalid transition");
}

// An entry is "stuck" once it's exceeded its age or attempt budget — dropped
// without another retry rather than kept forever.
function isStuck(entry: PendingStatusChange, now: number): boolean {
  const enqueuedAt = entry.enqueuedAt ?? entry.ts;
  const attempts = entry.attempts ?? 0;
  return now - enqueuedAt > MAX_AGE_MS || attempts >= MAX_ATTEMPTS;
}

function readGiveUpCount(): number {
  if (!hasStorage()) return 0;
  try {
    const raw = localStorage.getItem(GIVEUP_STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function bumpGiveUpCount(by: number): void {
  if (!hasStorage() || by <= 0) return;
  try {
    localStorage.setItem(GIVEUP_STORAGE_KEY, String(readGiveUpCount() + by));
  } catch {
    // best-effort — the banner is discreet, not critical.
  }
}

// Total entries ever given up on (age/attempts exhausted) since the last
// `clearGiveUpCount()` — drives the discreet "N acțiuni nu s-au putut
// sincroniza" banner, distinct from `pendingQueueCount()` (still retrying).
export function giveUpCount(): number {
  return readGiveUpCount();
}

// Dismisses the stuck-entry banner (the user acknowledged it).
export function clearGiveUpCount(): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(GIVEUP_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

// Detects a network-shaped failure (offline / dropped fetch) as opposed to a
// business rejection from the RPC — only the former should stay queued.
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return true;
  if (err instanceof TypeError) return true; // fetch-level failure ("Failed to fetch", "Load failed", ...)
  const message = err instanceof Error ? err.message : String(err);
  return /fetch|network/i.test(message);
}

// Re-sends every pending entry through `advance`. Resolved entries — success,
// or rejected as an invalid transition (the order moved on without us) — are
// removed; anything else stays queued for the next drain (attempts incremented) —
// unless it's exceeded its age (24h) or attempt (8) budget, in which case it's
// dropped without retrying and counted toward the stuck-entry banner.
export async function drainPendingQueue(advance: AdvanceFn): Promise<void> {
  const queue = readPendingQueue();
  if (queue.length === 0) return;

  const now = Date.now();
  const remaining: PendingStatusChange[] = [];
  let givenUp = 0;
  for (const entry of queue) {
    if (isStuck(entry, now)) {
      givenUp += 1;
      continue;
    }
    try {
      const result = await advance(entry.orderId, entry.newStatus, entry.paymentConfirmed);
      if (result.error && !isInvalidTransitionError(result.error)) {
        remaining.push({ ...entry, attempts: (entry.attempts ?? 0) + 1 });
      }
      // else: success, or invalid transition — drop, resolved either way.
    } catch {
      remaining.push({ ...entry, attempts: (entry.attempts ?? 0) + 1 }); // still offline / still failing — keep for next drain
    }
  }
  writePendingQueue(remaining);
  bumpGiveUpCount(givenUp);
}
