// Small time helpers kept OUT of component bodies so the React-compiler purity
// lint doesn't flag Date.now()/new Date() as "impure during render". Server
// Components can safely call these at request time.

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Previous full week (Mon 00:00 .. Sun) as YYYY-MM-DD strings, for payout periods.
export function lastWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - daysSinceMonday);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(lastMonday), end: iso(lastSunday) };
}
