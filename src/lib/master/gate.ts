import { createHash, timingSafeEqual } from "node:crypto";

// PRIVATE master doorway — a personal, local-only convenience that lets the app
// owner drop straight into any role sector without per-sector credentials.
// It is a backdoor into every role (including admin), so it is safe-by-default:
//   1. It only exists when ENABLE_MASTER_DOORWAY === "true" (default OFF).
//   2. Credentials live in env, never in source.
// Server-only utilities (uses node:crypto) — do NOT import into client code.

export const MASTER_COOKIE = "master_gate";

// The whole doorway is gated on an exact "true". Any other value (unset, "1",
// "TRUE", "") means the feature does not exist: pages notFound(), routes 404.
export function masterDoorwayEnabled(): boolean {
  return process.env.ENABLE_MASTER_DOORWAY === "true";
}

// Length-checked, timing-safe string compare. The length check can leak length,
// which is acceptable here — the point is to avoid a byte-by-byte early return.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// True only when BOTH env credentials are set and BOTH inputs match them.
// Missing/empty env → auth is impossible (always false).
export function checkMasterCredentials(user: string, pass: string): boolean {
  const envUser = process.env.MASTER_DOORWAY_USER;
  const envPass = process.env.MASTER_DOORWAY_PASS;
  if (!envUser || !envPass) return false;
  // Evaluate both comparisons regardless of the first result (no early &&).
  const userOk = safeEqual(user, envUser);
  const passOk = safeEqual(pass, envPass);
  return userOk && passOk;
}

// Opaque, non-guessable token stored in the httpOnly cookie once authed.
// Derived from the master pass so it rotates automatically if the pass changes,
// but never exposes the pass itself. Null when the pass env is missing (so the
// cookie can never match and every gated route stays closed).
export function masterCookieValue(): string | null {
  const envPass = process.env.MASTER_DOORWAY_PASS;
  if (!envPass) return null;
  return createHash("sha256").update(`master-gate:v1:${envPass}`).digest("hex");
}
