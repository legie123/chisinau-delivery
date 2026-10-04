// @vitest-environment node
// Verifier findings on @chisinau/shared-domain (money parity with the payout,
// Europe/Chisinau windows, offline-queue races). Every number below that is
// labelled "payout" was computed by Postgres with admin_generate_payouts' own
// expression (round(fee * pct / 100, 2) per order, then summed).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as domain from "@chisinau/shared-domain";
import {
  createStatusQueue,
  currentWeekRange,
  netForOrder,
  quotedNetMdl,
  summarizeEarnings,
  STATUS_QUEUE_KEY,
  type EarningsOrder,
  type KeyValueStorage,
} from "@chisinau/shared-domain";

// Seeded courier curier@test.md, 9 delivered rows (8 paid, 1 unpaid cash).
// psql, payout formula: gross 399.79, Σ round(fee*15/100,2) = 44.51, net 355.28.
const SEED: EarningsOrder[] = [
  { delivery_fee_mdl: 45.0, courier_fee_mdl: null, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 40.0, courier_fee_mdl: null, tip_mdl: 20.0, payment_status: "paid" },
  { delivery_fee_mdl: 42.0, courier_fee_mdl: null, tip_mdl: 5.0, payment_status: "paid" },
  { delivery_fee_mdl: 38.0, courier_fee_mdl: null, tip_mdl: 0.0, payment_status: "unpaid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 46.83, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 30.74, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 30.74, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 30.74, tip_mdl: 0.0, payment_status: "paid" },
  { delivery_fee_mdl: 45.0, courier_fee_mdl: 30.74, tip_mdl: 78.0, payment_status: "paid" },
];

describe("earnings = payout, to the ban", () => {
  it("summary rounds the commission PER ORDER then sums (admin_generate_payouts)", () => {
    expect(summarizeEarnings(SEED, 15)).toEqual({
      ordersCount: 8,
      grossMdl: 399.79,
      commissionMdl: 44.51,
      netMdl: 355.28,
      pendingCount: 1,
    });
  });

  it("history list (Σ netForOrder) equals the summary on the same screen", () => {
    const sum = SEED.map((o) => netForOrder(o, 15)).reduce<number>((a, n) => a + (n ?? 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(summarizeEarnings(SEED, 15).netMdl);
  });

  it("a .xx5 commission rounds half-up like Postgres numeric (21.90 @15% → 18.61)", () => {
    const o: EarningsOrder = { delivery_fee_mdl: 21.9, courier_fee_mdl: null, tip_mdl: 0, payment_status: "paid" };
    expect(netForOrder(o, 15)).toBe(18.61);
    expect(quotedNetMdl({ delivery_fee_mdl: 21.9 }, 15)).toBe(18.61);
  });

  it("brute force 20.00..150.00 MDL @15%: netForOrder == payout net for every fee", () => {
    const bad: string[] = [];
    for (let cents = 2000; cents <= 15000; cents++) {
      // Exact decimal reference: commission cents = half-up(cents * 15 / 100).
      const payoutNetCents = cents - Math.floor((cents * 15 * 2 + 100) / 200);
      const fee = cents / 100;
      const app = netForOrder({ delivery_fee_mdl: fee, tip_mdl: 0, payment_status: "paid" }, 15);
      if (Math.round((app ?? NaN) * 100) !== payoutNetCents) bad.push(`${fee}→${app}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe("commission per order at delivered_at (pricing_config_at)", () => {
  // public_pricing_history() shape: oldest first.
  const HISTORY = [
    { effective_from: "2026-01-01T00:00:00+00:00", courier_pct: 15 },
    { effective_from: "2026-10-01T00:00:00+00:00", courier_pct: 20 },
  ];

  it("pctAt picks the version in effect at delivered_at; before the first → fallback", () => {
    const pctAt = (domain as Record<string, unknown>).pctAt as (h: unknown, iso: string | null, f?: number) => number;
    expect(typeof pctAt).toBe("function");
    expect(pctAt(HISTORY, "2026-09-30T23:59:59Z")).toBe(15);
    expect(pctAt(HISTORY, "2026-10-01T00:00:00Z")).toBe(20); // effective_from <= ts
    expect(pctAt(HISTORY, "2026-10-03T08:00:00Z")).toBe(20);
    expect(pctAt(HISTORY, "2025-12-31T00:00:00Z", 17)).toBe(17); // pricing_config_at → null → fallback
    expect(pctAt([], "2026-10-03T08:00:00Z", 17)).toBe(17);
  });

  it("summary and per-order net apply each order's own version, not the current one", () => {
    const orders: EarningsOrder[] = [
      { delivery_fee_mdl: 100, tip_mdl: 0, payment_status: "paid", delivered_at: "2026-09-30T20:00:00Z" },
      { delivery_fee_mdl: 100, tip_mdl: 0, payment_status: "paid", delivered_at: "2026-10-02T20:00:00Z" },
    ];
    const s = summarizeEarnings(orders, HISTORY as never);
    expect(s.commissionMdl).toBe(35); // 15 + 20, not 2 × 20
    expect(s.netMdl).toBe(165);
    expect(netForOrder(orders[0], HISTORY as never)).toBe(85);
    expect(netForOrder(orders[1], HISTORY as never)).toBe(80);
  });
});

describe("day and week windows are Europe/Chisinau, whatever the device zone", () => {
  const savedTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York"; // a phone/server that is NOT in Chisinau
  });
  afterAll(() => {
    process.env.TZ = savedTz;
  });

  const todayStart = () => (domain as Record<string, unknown>).todayStart as (now: Date) => Date;
  const iso = (d: Date) => d.toISOString();

  it("week: Monday 00:00 Chisinau .. next Monday, start date = the Chisinau Monday", () => {
    const w = currentWeekRange(new Date("2026-10-04T09:00:00Z")) as { start: Date; end: Date; startDate?: string };
    expect(iso(w.start)).toBe("2026-09-27T21:00:00.000Z");
    expect(iso(w.end)).toBe("2026-10-04T21:00:00.000Z");
    expect(w.startDate).toBe("2026-09-28"); // what date_trunc('week', ts at time zone 'Europe/Chisinau') gives
  });

  it("Monday 01:00 Chisinau (Sunday 22:00 UTC) is already the new week", () => {
    const w = currentWeekRange(new Date("2026-10-04T22:00:00Z")) as { start: Date; startDate?: string };
    expect(iso(w.start)).toBe("2026-10-04T21:00:00.000Z");
    expect(w.startDate).toBe("2026-10-05");
  });

  it("DST end 2026-10-25: that week is 169h and ends at EET midnight", () => {
    const w = currentWeekRange(new Date("2026-10-25T12:00:00Z"));
    expect(iso(w.start)).toBe("2026-10-18T21:00:00.000Z"); // Mon 19 Oct 00:00 EEST
    expect(iso(w.end)).toBe("2026-10-25T22:00:00.000Z"); // Mon 26 Oct 00:00 EET
  });

  it("todayStart: Chisinau midnight, across the 2026-10-25 and 2026-03-29 switches", () => {
    expect(typeof todayStart()).toBe("function");
    expect(iso(todayStart()(new Date("2026-10-25T00:30:00Z")))).toBe("2026-10-24T21:00:00.000Z"); // 03:30 EEST
    expect(iso(todayStart()(new Date("2026-10-25T12:00:00Z")))).toBe("2026-10-24T21:00:00.000Z");
    expect(iso(todayStart()(new Date("2026-10-25T22:30:00Z")))).toBe("2026-10-25T22:00:00.000Z"); // Mon 00:30 EET
    expect(iso(todayStart()(new Date("2026-10-04T21:30:00Z")))).toBe("2026-10-04T21:00:00.000Z"); // Mon 00:30 EEST
    expect(iso(todayStart()(new Date("2026-03-29T12:00:00Z")))).toBe("2026-03-28T22:00:00.000Z"); // EET midnight
    expect(iso(todayStart()(new Date("2026-03-30T12:00:00Z")))).toBe("2026-03-29T21:00:00.000Z"); // EEST midnight
  });
});

describe("web courier pages use the Chisinau windows and the per-order commission", () => {
  const read = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
  const PAGES = [
    "src/app/(courier)/deliveries/page.tsx",
    "src/app/(courier)/deliveries/history/page.tsx",
    "src/app/(courier)/earnings/page.tsx",
  ];
  for (const f of PAGES) {
    it(`${f}: commission from the pricing history, windows from shared-domain`, () => {
      const src = read(f);
      expect(src).toMatch(/getPublicPricingHistory/);
      expect(src).not.toMatch(/setHours\(0, 0, 0, 0\)/);
      expect(src).not.toMatch(/currentWeekRange\(\)/); // explicit now
    });
  }
  it("survey week key is the Chisinau calendar date, not toISOString()", () => {
    const src = read("src/app/(courier)/deliveries/page.tsx");
    expect(src).not.toMatch(/\.start\.toISOString\(\)\.slice\(0, 10\)/);
    expect(src).toMatch(/startDate/);
  });
});

// AsyncStorage-shaped store with a controllable getItem.
function store(): KeyValueStorage & { map: Map<string, string>; failNextGet: boolean } {
  const map = new Map<string, string>();
  const s = {
    map,
    failNextGet: false,
    getItem: async (k: string) => {
      if (s.failNextGet) {
        s.failNextGet = false;
        throw new Error("AsyncStorage: transient");
      }
      return map.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => void map.set(k, v),
    removeItem: async (k: string) => void map.delete(k),
  };
  return s;
}

describe("offline status queue races", () => {
  it("two overlapping drains send each tap once (single-flight)", async () => {
    const s = store();
    const q = createStatusQueue(s);
    await q.enqueue({ orderId: "o1", newStatus: "delivered", ts: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const advance = vi.fn(async () => {
      await gate;
      return { error: null };
    });
    const a = q.drain(advance);
    const b = q.drain(advance);
    release();
    await Promise.all([a, b]);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(await q.count()).toBe(0);
  });

  it("one stuck entry under two overlapping drains counts as ONE give-up", async () => {
    const s = store();
    const q = createStatusQueue(s);
    await q.enqueue({ orderId: "o1", newStatus: "delivered", ts: 1, attempts: 8 });
    const advance = vi.fn(async () => ({ error: null }));
    await Promise.all([q.drain(advance), q.drain(advance)]);
    expect(await q.giveUpCount()).toBe(1);
  });

  it("clearGiveUpCount(seen) keeps a give-up recorded after the banner rendered", async () => {
    const s = store();
    const q = createStatusQueue(s);
    await q.enqueue({ orderId: "o1", newStatus: "delivered", ts: 1, attempts: 8 });
    await q.drain(async () => ({ error: null }));
    const shown = await q.giveUpCount(); // banner renders "1"
    await q.enqueue({ orderId: "o9", newStatus: "delivered", ts: 2, attempts: 8 });
    await q.drain(async () => ({ error: null })); // o9 given up before the tap
    await (q.clearGiveUpCount as (seen?: number) => Promise<void>)(shown);
    expect(await q.giveUpCount()).toBe(1); // o9 still to be shown
    await (q.clearGiveUpCount as (seen?: number) => Promise<void>)(1);
    expect(await q.giveUpCount()).toBe(0);
  });

  it("a transient getItem failure during enqueue never erases the other pending taps", async () => {
    const s = store();
    const q = createStatusQueue(s);
    await q.enqueue({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    await q.enqueue({ orderId: "o2", newStatus: "picked_up", ts: 2 });
    s.failNextGet = true;
    await q.enqueue({ orderId: "o3", newStatus: "picked_up", ts: 3 }).catch(() => undefined);
    const ids = (JSON.parse(s.map.get(STATUS_QUEUE_KEY) ?? "[]") as { orderId: string }[]).map((e) => e.orderId);
    expect(ids).toEqual(expect.arrayContaining(["o1", "o2"]));
  });

  it("a transient getItem failure in the drain merge never erases the queue", async () => {
    const s = store();
    const q = createStatusQueue(s);
    await q.enqueue({ orderId: "o1", newStatus: "picked_up", ts: 1 });
    await q.enqueue({ orderId: "o2", newStatus: "picked_up", ts: 2 });
    // o1 fails (stays), o2 is sent while the courier taps o3; then the merge read fails.
    const advance = vi.fn(async (id: string) => {
      if (id === "o2") {
        await q.enqueue({ orderId: "o3", newStatus: "picked_up", ts: 3 });
        s.failNextGet = true;
      }
      return id === "o1" ? { error: "boom" } : { error: null };
    });
    await q.drain(advance).catch(() => undefined);
    const ids = (JSON.parse(s.map.get(STATUS_QUEUE_KEY) ?? "[]") as { orderId: string }[]).map((e) => e.orderId);
    expect(ids).toEqual(expect.arrayContaining(["o1", "o3"]));
  });
});
