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

export type PendingStatusChange = {
  orderId: string;
  newStatus: string;
  paymentConfirmed?: boolean;
  ts: number;
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

// One pending entry per order — a newer tap supersedes an older, unsent one.
export function enqueueStatusChange(entry: PendingStatusChange): void {
  const queue = readPendingQueue().filter((e) => e.orderId !== entry.orderId);
  queue.push(entry);
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
// removed; anything else stays queued for the next drain.
export async function drainPendingQueue(advance: AdvanceFn): Promise<void> {
  const queue = readPendingQueue();
  if (queue.length === 0) return;

  const remaining: PendingStatusChange[] = [];
  for (const entry of queue) {
    try {
      const result = await advance(entry.orderId, entry.newStatus, entry.paymentConfirmed);
      if (result.error && !isInvalidTransitionError(result.error)) {
        remaining.push(entry);
      }
      // else: success, or invalid transition — drop, resolved either way.
    } catch {
      remaining.push(entry); // still offline / still failing — keep for next drain
    }
  }
  writePendingQueue(remaining);
}
