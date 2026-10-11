// Idle position heartbeat. dispatch_order ranks couriers with a position from the last
// 2 minutes first (migration 20261011000300), but the app only wrote positions during a
// delivery, so every idle courier looked position-less. While online and idle, MapScreen
// re-sends the last fix every HEARTBEAT_MS. Foreground only: no new background permission.
export const HEARTBEAT_MS = 45_000;

export function heartbeatDue(s: {
  online: boolean;
  delivering: boolean; // the background task (lib/backgroundLocation) owns writes then
  hasFix: boolean;
  lastAt: number;
  now: number;
}): boolean {
  return s.online && !s.delivering && s.hasFix && s.now - s.lastAt >= HEARTBEAT_MS;
}
