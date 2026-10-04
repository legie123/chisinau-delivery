import { RpcError } from "@chisinau/shared-api";

// Romanian text for anything thrown at the customer. shared-api mapPgError gives a
// fixed Romanian line for every code except P0001, where it passes the RPC's own
// `raise exception` text through — and several customer-reachable RPCs still raise
// in English (cancel_order, set_order_tip, submit_rating, confirm_catering_quote).
// Known messages are mapped here (substring, first match wins); anything else is
// shown only if it is already Romanian, otherwise the caller's fallback.

const STALE_LINE = "Un produs din coș s-a schimbat — scoate-l și adaugă-l din nou.";

export const KNOWN_ERRORS: [string, string][] = [
  // order lifecycle on the tracking screen (a stale screen still shows the button)
  ["too late to cancel", "Restaurantul a confirmat deja comanda — nu mai poate fi anulată."],
  ["too late to tip", "Bacșișul nu mai poate fi modificat pentru această comandă."],
  ["invalid tip", "Suma bacșișului nu este validă."],
  ["already rated", "Ai evaluat deja această comandă."],
  ["rating window closed", "Perioada de evaluare pentru această comandă s-a încheiat."],
  ["order not delivered yet", "Poți evalua comanda doar după ce a fost livrată."],
  ["invalid rating target", "Evaluarea nu se potrivește acestei comenzi."],
  ["no active quote to confirm", "Oferta nu mai este activă — reîncarcă comanda."],
  ["invalid transition", "Comanda și-a schimbat deja starea — reîncarcă ecranul."],
  ["authentication required", "Trebuie să fii autentificat."],
  ["not authenticated", "Trebuie să fii autentificat."],
  ["order not found", "Comanda nu a fost găsită."],
  // place_order
  ["below minimum", "Comanda nu atinge minimul restaurantului."],
  ["not currently accepting", "Restaurantul nu acceptă comenzi momentan."],
  ["1400 MDL", "Comenzile peste 1400 MDL se achită cu cardul la livrare — alege «Card (POS)»."],
  ["închis la ora", "Restaurantul este închis acum. Alege alt restaurant sau revino mai târziu."],
  ["menu item unavailable", "Un articol din coș nu mai este disponibil — reîncarcă meniul."],
  ["alege o opțiune", "Un produs are opțiuni obligatorii neconfigurate — scoate-l și adaugă-l din nou."],
  ["opțiune invalidă", STALE_LINE],
  ["prea multe opțiuni", STALE_LINE],
  ["prea puține opțiuni", STALE_LINE],
  ["invalid quantity", "Cantitate invalidă pentru unul dintre articole."],
  ["cart is empty", "Coșul este gol."],
  ["restaurant not found", "Restaurantul nu mai este disponibil."],
  ["invalid catering request", "Cererea de catering este incompletă — verifică data și datele de contact."],
];

const ROMANIAN = /[ăâîșțşţ]/i;

/** Message for the user from any thrown error. `extra` (checked first) lets a screen
 *  word a known failure for its own context. */
export function errorText(err: unknown, fallback: string, extra: [string, string][] = []): string {
  const raw = err instanceof Error ? err.message : "";
  const known = [...extra, ...KNOWN_ERRORS].find(([needle]) => raw.includes(needle));
  if (known) return known[1];
  // Every non-P0001 code already maps to a fixed Romanian line.
  if (err instanceof RpcError && err.code !== "P0001") return err.userMessage;
  // P0001 raw text or the app's own thrown Error: only if it is Romanian.
  return raw && raw.length < 200 && ROMANIAN.test(raw) ? raw : fallback;
}
