import { describe, expect, it } from "vitest";
import {
  earliestOpening,
  isOpenNow,
  nextOpeningAt,
  nextOpeningLabel,
  type HoursRow,
} from "@chisinau/shared-domain";

// Ora restaurantului nu e o decorațiune: pe ea stă singura întrebare a unui om
// flămând în fața unei liste închise — „și atunci când?". Logica exista din
// `20260815`, dar netestată și consumată doar de pagina de meniu; valul V7 o
// aduce în listă, deci întâi primește probe.

const row = (day: number, opens: string, closes: string, closed = false): HoursRow => ({
  restaurant_id: "r1",
  day_of_week: day,
  opens_at: opens,
  closes_at: closes,
  is_closed: closed,
});

// Program de noapte real din seed: 10:00 → 03:00, deci fereastra trece de
// miezul nopții și e stocată pe ziua în care ÎNCEPE.
const nightWeek = (): HoursRow[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => row(d, "10:00:00", "03:00:00"));

describe("isOpenNow", () => {
  it("is open inside today's plain window", () => {
    expect(isOpenNow([row(1, "10:00:00", "22:00:00")], 1, "12:00:00")).toBe(true);
    expect(isOpenNow([row(1, "10:00:00", "22:00:00")], 1, "23:00:00")).toBe(false);
  });

  it("stays open past midnight on YESTERDAY's overnight row", () => {
    const rows = [row(0, "10:00:00", "03:00:00"), row(1, "10:00:00", "03:00:00")];
    // luni 02:00 — fereastra care ține e cea de duminică
    expect(isOpenNow(rows, 1, "02:00:00")).toBe(true);
    // luni 04:00 — s-a închis, iar cea de azi nu s-a deschis
    expect(isOpenNow(rows, 1, "04:00:00")).toBe(false);
  });

  it("treats an is_closed row as closed even inside its clock window", () => {
    expect(isOpenNow([row(1, "10:00:00", "22:00:00", true)], 1, "12:00:00")).toBe(false);
  });
});

describe("nextOpeningAt", () => {
  it("points at today when the window is still ahead", () => {
    expect(nextOpeningAt(nightWeek(), 1, "04:00:00")).toEqual({ ahead: 0, opens: "10:00:00" });
  });

  it("skips to tomorrow once today's window has already started", () => {
    expect(nextOpeningAt(nightWeek(), 1, "12:00:00")).toEqual({ ahead: 1, opens: "10:00:00" });
  });

  it("skips days marked closed", () => {
    const rows = nightWeek().map((r) => (r.day_of_week === 2 ? { ...r, is_closed: true } : r));
    expect(nextOpeningAt(rows, 1, "12:00:00")).toEqual({ ahead: 2, opens: "10:00:00" });
  });

  it("returns null when the week holds no open window at all", () => {
    expect(nextOpeningAt(nightWeek().map((r) => ({ ...r, is_closed: true })), 1, "12:00:00")).toBeNull();
  });

  // CONTRACTUL, scris ca probă fiindcă exact aici se năștea minciuna: funcția
  // caută ziua următoare printre rândurile PRIMITE. Pagina de listă cerea din
  // DB doar ziua de azi și pe cea de ieri (destul pentru „deschis acum"), deci
  // după ce fereastra de azi pornea, singurul rând rămas era al zilei de ieri —
  // adică peste ȘASE zile. „Deschide sâmbătă" pentru un local care deschide
  // mâine. De-aia `/restaurants` cere acum săptămâna întreagă.
  it("can only look as far ahead as the rows it was given (why the list fetches the whole week)", () => {
    const sparse = [row(0, "10:00:00", "03:00:00"), row(1, "10:00:00", "03:00:00")]; // ieri + azi
    expect(nextOpeningAt(sparse, 1, "12:00:00")).toEqual({ ahead: 6, opens: "10:00:00" });
    expect(nextOpeningAt(nightWeek(), 1, "12:00:00")).toEqual({ ahead: 1, opens: "10:00:00" });
  });
});

describe("nextOpeningLabel", () => {
  it("says azi / mâine / the weekday name", () => {
    expect(nextOpeningLabel(nightWeek(), 1, "04:00:00")).toBe("azi la 10:00");
    expect(nextOpeningLabel(nightWeek(), 1, "12:00:00")).toBe("mâine la 10:00");
    const rows = nightWeek().map((r) => (r.day_of_week === 2 ? { ...r, is_closed: true } : r));
    expect(nextOpeningLabel(rows, 1, "12:00:00")).toBe("miercuri la 10:00");
  });

  it("is null when nothing ever opens", () => {
    expect(nextOpeningLabel(nightWeek().map((r) => ({ ...r, is_closed: true })), 1, "12:00:00")).toBeNull();
  });
});

describe("earliestOpening", () => {
  it("picks the soonest opening across the whole list", () => {
    const soon = { ahead: 0, opens: "10:00:00" };
    const later = { ahead: 0, opens: "18:00:00" };
    const tomorrow = { ahead: 1, opens: "08:00:00" };
    expect(earliestOpening([later, tomorrow, soon])).toEqual(soon);
  });

  it("compares the day BEFORE the clock — tomorrow at 08:00 is later than today at 18:00", () => {
    expect(earliestOpening([{ ahead: 1, opens: "08:00:00" }, { ahead: 0, opens: "18:00:00" }])).toEqual({
      ahead: 0,
      opens: "18:00:00",
    });
  });

  it("ignores restaurants with no opening at all, and returns null when none has one", () => {
    expect(earliestOpening([null, { ahead: 2, opens: "09:00:00" }, null])).toEqual({ ahead: 2, opens: "09:00:00" });
    expect(earliestOpening([null, null])).toBeNull();
  });
});
