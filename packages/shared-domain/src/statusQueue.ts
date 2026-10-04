// Minimal offline queue for courier status changes (advance_delivery_status).
//
// A courier loses signal in a stairwell / dead zone, taps "Am ridicat" / "Am
// livrat" — the RPC call fails and the update would otherwise be lost, leaving
// the order looking stuck to everyone. This persists the intended transition
// in an injected key-value store and replays it once connectivity returns.
//
// Platform-free: the store and the RPC caller are both injected. The web app
// passes the browser's synchronous storage + its Server Action; the native app
// passes AsyncStorage + a @chisinau/shared-api call. Every method is async so
// one implementation serves both.
//
// advance_delivery_status is idempotent (a call with the order already in
// the target status just returns), so re-sending a resolved entry is
// harmless. An entry whose transition is no longer valid — RPC raises
// "invalid transition X -> Y", e.g. another device already advanced the
// order — is dropped rather than retried forever.

export const STATUS_QUEUE_KEY = "chisinau-courier-pending-status";
export const STATUS_QUEUE_GIVEUP_KEY = "chisinau-courier-giveup-count";

// A dead zone that lasts hours (tunnel, rural delivery, phone off) shouldn't
// leave an entry retrying forever — cap both its age and its attempt count.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;

// Sync (browser storage) or async (AsyncStorage / secure-store) — both fit.
export type KeyValueStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};

export type PendingStatusChange = {
  orderId: string;
  newStatus: string;
  paymentConfirmed?: boolean;
  // Caller-supplied tap timestamp — used for display/ordering only, NOT
  // trusted for the 24h staleness check (tests and some callers use it as a
  // plain sequence number, not real wall-clock time). See `enqueuedAt`.
  ts: number;
  // Real wall-clock moment this entry entered the queue — stamped with
  // `Date.now()` by `enqueue` regardless of `ts`. Optional only so
  // already-persisted entries from before this field existed decode fine
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

// Identity of ONE enqueue (a re-tap for the same order is a different entry).
function entryKey(e: PendingStatusChange): string {
  return `${e.orderId}|${e.newStatus}|${e.enqueuedAt ?? e.ts}`;
}

// Detects a network-shaped failure (dropped fetch) as opposed to a business
// rejection from the RPC — only the former should stay queued. Platform
// connectivity flags (e.g. the browser's onLine) are the caller's to add.
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch-level failure ("Failed to fetch", "Network request failed", ...)
  const message = err instanceof Error ? err.message : String(err);
  return /fetch|network/i.test(message);
}

export type StatusQueue = ReturnType<typeof createStatusQueue>;

// A replay that never settles (no fetch timeout in supabase-js / RN, a stuck token refresh)
// held the single-flight drain forever, so every later tap stayed queued until a restart.
// Timing out reads as a network error: the entry stays queued, and a late success is harmless
// because advance_delivery_status is idempotent.
export const ADVANCE_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TypeError("network timeout")), ADVANCE_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function createStatusQueue(storage: KeyValueStorage) {
  // Read-modify-write of the stored list must not interleave inside one queue
  // instance: with an async store, two enqueues (or an enqueue during a drain's
  // final write) would otherwise overwrite each other and lose a tap. Only the
  // short storage critical sections are serialized — the network calls of a
  // drain run outside, so a slow RPC never blocks a new tap from persisting.
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  }

  // For the read-modify-write paths: a storage READ error propagates, so the
  // caller never writes an "empty" view over taps it simply failed to see.
  // Unparseable content is unrecoverable anyway and reads as empty.
  async function readStrict(): Promise<PendingStatusChange[]> {
    const raw = await storage.getItem(STATUS_QUEUE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // Read-only callers (count, hasPending, drain's snapshot): [] on any failure.
  async function read(): Promise<PendingStatusChange[]> {
    try {
      return await readStrict();
    } catch {
      return [];
    }
  }

  // One drain at a time per queue: the web fires 'online' to both the layout
  // sync and the order page; overlapping drains sent a tap twice, double-counted
  // give-ups and resurrected an entry the other drain had already delivered.
  let draining: Promise<void> | null = null;

  async function write(queue: PendingStatusChange[]): Promise<void> {
    try {
      await storage.setItem(STATUS_QUEUE_KEY, JSON.stringify(queue));
    } catch {
      // Storage full/unavailable (private mode) — queue is best-effort, drop silently.
    }
  }

  // Strict for the read-modify-write paths (clear, drain merge): a failed read must skip the
  // write, not treat the count as 0 and erase give-ups the banner has not shown yet.
  async function readGiveUpStrict(): Promise<number> {
    const raw = await storage.getItem(STATUS_QUEUE_GIVEUP_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  async function readGiveUp(): Promise<number> {
    try {
      return await readGiveUpStrict();
    } catch {
      return 0;
    }
  }

  const api = {
    read,

    // One pending entry per order — a newer tap supersedes an older, unsent one
    // (and restarts its age/attempts clock — it's a fresh intended transition).
    enqueue(entry: PendingStatusChange): Promise<void> {
      return serial(async () => {
        let current: PendingStatusChange[];
        try {
          current = await readStrict();
        } catch {
          throw new Error("Nu am putut salva acțiunea offline. Încearcă din nou.");
        }
        const queue = current.filter((e) => e.orderId !== entry.orderId);
        queue.push({ ...entry, enqueuedAt: entry.enqueuedAt ?? Date.now(), attempts: entry.attempts ?? 0 });
        await write(queue);
      });
    },

    async hasPending(orderId: string): Promise<boolean> {
      return (await read()).some((e) => e.orderId === orderId);
    },

    // Total pending changes across ALL orders — drives the app-level "N acțiuni
    // în așteptare" banner (not order-scoped like hasPending).
    async count(): Promise<number> {
      return (await read()).length;
    },

    // Total entries ever given up on (age/attempts exhausted) since the last
    // `clearGiveUpCount()` — drives the discreet "N acțiuni nu s-au putut
    // sincroniza" banner, distinct from `count()` (still retrying).
    giveUpCount: readGiveUp,

    // Dismisses the stuck-entry banner (the user acknowledged it). Pass the
    // number the banner SHOWED: a give-up recorded after it rendered survives
    // to the next banner. No argument = clear everything (legacy callers).
    clearGiveUpCount(seen?: number): Promise<void> {
      return serial(async () => {
        try {
          const left = seen === undefined ? 0 : (await readGiveUpStrict()) - seen;
          if (left > 0) await storage.setItem(STATUS_QUEUE_GIVEUP_KEY, String(left));
          else await storage.removeItem(STATUS_QUEUE_GIVEUP_KEY);
        } catch {
          // best-effort
        }
      });
    },

    // Re-sends every pending entry through `advance`. Resolved entries — success,
    // or rejected as an invalid transition (the order moved on without us) — are
    // removed; anything else stays queued for the next drain (attempts incremented) —
    // unless it's exceeded its age (24h) or attempt (8) budget, in which case it's
    // dropped without retrying and counted toward the stuck-entry banner. An entry
    // enqueued WHILE the drain was on the network is kept (merged on write).
    async drain(advance: AdvanceFn): Promise<void> {
      const queue = await read();
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
          const result = await withTimeout(advance(entry.orderId, entry.newStatus, entry.paymentConfirmed));
          if (result.error && !isInvalidTransitionError(result.error)) {
            remaining.push({ ...entry, attempts: (entry.attempts ?? 0) + 1 });
          }
          // else: success, or invalid transition — drop, resolved either way.
        } catch {
          // A throw is network-shaped in both bindings (business errors come back as
          // {error}). Being offline is not a failed attempt: callers drain every 30s
          // regardless of connectivity, so counting it dropped taps after ~4 min.
          remaining.push(entry); // the 24h age cap still bounds a dead zone
        }
      }

      await serial(async () => {
        const seen = new Set(queue.map(entryKey));
        let current: PendingStatusChange[];
        try {
          current = await readStrict();
        } catch {
          return; // can't see what's stored: leave it; sent entries re-send idempotently
        }
        const added = current.filter((e) => !seen.has(entryKey(e)));
        const supersededOrders = new Set(added.map((e) => e.orderId));
        await write([...remaining.filter((e) => !supersededOrders.has(e.orderId)), ...added]);
        if (givenUp > 0) {
          try {
            await storage.setItem(STATUS_QUEUE_GIVEUP_KEY, String((await readGiveUpStrict()) + givenUp));
          } catch {
            // best-effort — the banner is discreet, not critical.
          }
        }
      });
    },
  };

  // Single-flight: a drain requested while one runs joins it.
  const drainOnce = api.drain;
  api.drain = (advance: AdvanceFn) =>
    (draining ??= drainOnce(advance).finally(() => {
      draining = null;
    }));
  return api;
}
