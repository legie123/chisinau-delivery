// Restaurant opening-hours logic shared by the browse list and the menu page.
// Mirrors the SQL restaurant_open_at() semantics (incl. overnight spans that
// are stored under the day they START — audit #15). Pure, SSR-safe.

export type HoursRow = {
  restaurant_id: string;
  day_of_week: number;
  opens_at: string; // "HH:MM:SS" Postgres time — compares lexically
  closes_at: string;
  is_closed: boolean;
};

/** "Now" in Europe/Chisinau service time → day_of_week (0=Sun..6=Sat) and a
 *  "HH:MM:SS" clock string that compares lexically against Postgres `time`. */
export function chisinauNow(): { dow: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Chisinau",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[get("weekday")] ?? 0, time: `${get("hour")}:${get("minute")}:${get("second")}` };
}

/** True when one of the rows (today's, or yesterday's overnight span) is open now. */
export function isOpenNow(rows: HoursRow[], dow: number, time: string): boolean {
  const prevDow = (dow + 6) % 7;
  return rows.some((h) => {
    if (h.is_closed) return false;
    const overnight = h.closes_at <= h.opens_at;
    if (h.day_of_week === dow) {
      return overnight ? time >= h.opens_at : time >= h.opens_at && time <= h.closes_at;
    }
    return h.day_of_week === prevDow && overnight && time <= h.closes_at;
  });
}

const DAY_LABEL = ["duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"];

/** Când se deschide data viitoare, ca pereche ordonabilă: `ahead` = peste câte
 *  zile, `opens` = ora. Separată de etichetă fiindcă lista are nevoie să COMPARE
 *  deschiderile a unsprezece restaurante, iar „mâine la 08:00" și „azi la 18:00"
 *  nu se compară ca text.
 *
 *  ATENȚIE la contract: caută doar printre rândurile primite. Cine vrea un
 *  răspuns corect îi dă săptămâna întreagă — cu doar azi+ieri (cât îi trebuie
 *  lui `isOpenNow`) răspunsul poate sări cu șase zile. Probat în `hours.test.ts`. */
export function nextOpeningAt(
  rows: HoursRow[],
  dow: number,
  time: string,
): { ahead: number; opens: string } | null {
  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = (dow + ahead) % 7;
    const row = rows.find((h) => h.day_of_week === d && !h.is_closed);
    if (!row) continue;
    if (ahead === 0 && time >= row.opens_at) continue; // today's span already started (or passed)
    return { ahead, opens: row.opens_at };
  }
  return null;
}

/** Human label for the NEXT opening ("azi la 11:00", "mâine la 11:00",
 *  "vineri la 12:00") — null when no open span exists at all. */
export function nextOpeningLabel(rows: HoursRow[], dow: number, time: string): string | null {
  const next = nextOpeningAt(rows, dow, time);
  if (!next) return null;
  return `${openingWhen(next.ahead, dow)} la ${next.opens.slice(0, 5)}`;
}

/** „azi" / „mâine" / numele zilei, pentru o deschidere aflată peste `ahead` zile. */
export function openingWhen(ahead: number, dow: number): string {
  if (ahead === 0) return "azi";
  if (ahead === 1) return "mâine";
  return DAY_LABEL[(dow + ahead) % 7];
}

/** Cea mai apropiată deschidere dintr-o listă întreagă — ziua înaintea orei.
 *  Rândurile fără nicio deschidere se ignoră; null = nimeni nu mai deschide. */
export function earliestOpening(
  all: ({ ahead: number; opens: string } | null)[],
): { ahead: number; opens: string } | null {
  return all.reduce<{ ahead: number; opens: string } | null>((best, cur) => {
    if (!cur) return best;
    if (!best) return cur;
    if (cur.ahead !== best.ahead) return cur.ahead < best.ahead ? cur : best;
    return cur.opens < best.opens ? cur : best;
  }, null);
}
