import { RpcError, romanianRaiseText } from "@chisinau/shared-api";

// Romanian text for anything thrown at the customer. shared-api mapPgError gives a
// fixed Romanian line for every code except P0001, where it passes the RPC's own
// `raise exception` text through — and several customer-reachable RPCs still raise
// in English (cancel_order, set_order_tip, submit_rating, confirm_catering_quote).
// Known messages are mapped here (substring, first match wins); anything else is
// shown only if it is already Romanian, otherwise the caller's fallback.

const STALE_LINE = "Un produs din coș s-a schimbat — scoate-l și adaugă-l din nou.";

// The shared table (packages/shared-api KNOWN_ERRORS) covers every RPC text for every surface;
// these are the client-screen wordings that differ from it.
export const KNOWN_ERRORS: [string, string][] = [
  ["1400 MDL", "Comenzile peste 1400 MDL se achită cu cardul la livrare — alege «Card (POS)»."],
  ["închis la ora", "Restaurantul este închis acum. Alege alt restaurant sau revino mai târziu."],
  ["alege o opțiune", "Un produs are opțiuni obligatorii neconfigurate — scoate-l și adaugă-l din nou."],
  ["opțiune invalidă", STALE_LINE],
  ["prea multe opțiuni", STALE_LINE],
  ["prea puține opțiuni", STALE_LINE],
];

/** Message for the user from any thrown error. `extra` (checked first) lets a screen
 *  word a known failure for its own context. */
export function errorText(err: unknown, fallback: string, extra: [string, string][] = []): string {
  const raw = err instanceof Error ? err.message : "";
  const known = [...extra, ...KNOWN_ERRORS].find(([needle]) => raw.includes(needle));
  if (known) return known[1];
  // Every non-P0001 code already maps to a fixed Romanian line.
  if (err instanceof RpcError && err.code !== "P0001") return err.userMessage;
  // P0001 raw text or the app's own thrown Error: the shared table, then Romanian-only.
  return romanianRaiseText(raw) ?? fallback;
}

/** GoTrue sign-in / sign-up error text -> the same Romanian line the web LoginForm shows.
 *  `raw` is supabase-js `error.message` (signIn/signUp in api.ts return only that). */
export function loginErrorText(raw: string): string {
  if (raw.includes("Invalid login credentials")) return "Email sau parolă greșite.";
  if (/already (been )?registered|already exists/i.test(raw)) return "Există deja un cont cu acest email.";
  if (raw.includes("at least 6 characters") || raw.includes("Password should")) return "Parola trebuie să aibă minim 6 caractere.";
  if (/valid email|invalid format|email address .* is invalid/i.test(raw)) return "Emailul nu pare valid.";
  if (raw.includes("Email not confirmed")) return "Confirmă emailul din mesajul primit, apoi autentifică-te.";
  if (/rate limit|too many/i.test(raw)) return "Prea multe încercări — încearcă din nou peste câteva minute.";
  if (/network|fetch/i.test(raw)) return "Nu ne-am putut conecta. Verifică internetul și încearcă din nou.";
  return "A apărut o eroare. Încearcă din nou.";
}
