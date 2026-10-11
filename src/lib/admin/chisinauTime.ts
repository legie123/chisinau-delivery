// A <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm") read as Chișinău wall-clock time
// (EET/EEST, DST-aware), returned as an ISO UTC string — or null when it is not a real moment.
const OFFSET_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Chisinau", timeZoneName: "longOffset" });

function offsetMinutes(at: Date): number {
  const name = OFFSET_FMT.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

export function chisinauLocalToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(asUtc);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h || check.getUTCMinutes() !== mi) {
    return null; // 2026-13-40 and friends
  }
  // Two passes: the offset at the guessed instant, then at the corrected one (DST edges).
  let t = asUtc - offsetMinutes(new Date(asUtc)) * 60_000;
  t = asUtc - offsetMinutes(new Date(t)) * 60_000;
  return new Date(t).toISOString();
}
