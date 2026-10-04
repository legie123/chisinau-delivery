import type { PostgrestError } from "@supabase/supabase-js";

// Uniform RPC error with a Romanian user-facing message, mapped from Postgres
// error codes — so the courier on Expo and the admin on web see the SAME words
// for the same `raise exception`, instead of each surface improvising.
export class RpcError extends Error {
  readonly code: string | null;
  readonly userMessage: string;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "RpcError";
    this.code = error.code ?? null;
    this.userMessage = mapPgError(error);
  }
}

// RPC `raise exception` texts (P0001) that are not Romanian, or Romanian without diacritics,
// mapped once here for EVERY surface (web actions, courier + client apps, partner, admin).
// Substring match, first hit wins. Before 2026-10-04 P0001 passed the raw text through, so the web
// showed "too late to cancel" etc. and the client app kept its own copy of this table.
export const KNOWN_ERRORS: [string, string][] = [
  // customer order lifecycle
  ["too late to cancel", "Restaurantul a confirmat deja comanda — nu mai poate fi anulată."],
  ["too late to tip", "Bacșișul nu mai poate fi modificat pentru această comandă."],
  ["invalid tip", "Suma bacșișului nu este validă."],
  ["already rated", "Ai evaluat deja această comandă."],
  ["rating window closed", "Perioada de evaluare pentru această comandă s-a încheiat."],
  ["order not delivered yet", "Poți evalua comanda doar după ce a fost livrată."],
  ["invalid rating target", "Evaluarea nu se potrivește acestei comenzi."],
  ["stars must be 1-5", "Alege între 1 și 5 stele."],
  ["no active quote to confirm", "Oferta nu mai este activă — reîncarcă comanda."],
  ["already paid", "Comanda este deja plătită."],
  // place_order
  ["below minimum", "Comanda nu atinge minimul restaurantului."],
  ["not currently accepting", "Restaurantul nu acceptă comenzi momentan."],
  ["menu item unavailable", "Un articol din coș nu mai este disponibil — reîncarcă meniul."],
  ["invalid quantity", "Cantitate invalidă pentru unul dintre articole."],
  ["cart is empty", "Coșul este gol."],
  ["restaurant not found", "Restaurantul nu mai este disponibil."],
  ["invalid catering request", "Cererea de catering este incompletă — verifică data și datele de contact."],
  ["coordinates outside service area", "Adresa este în afara zonei de livrare."],
  ["adresa de livrare este obligatorie", "Adresa de livrare este obligatorie."],
  // courier
  ["oferta a expirat", "Oferta a expirat."],
  ["oferta nu mai este activa", "Oferta nu mai este activă."],
  ["comanda nu mai este disponibila", "Comanda nu mai este disponibilă."],
  ["offer not found", "Oferta nu mai există."],
  ["you already have an active delivery", "Ai deja o livrare în curs."],
  ["order not available for assignment", "Comanda nu mai este disponibilă."],
  ["too far from restaurant", "Ești prea departe de restaurant pentru a prelua comanda."],
  ["not an active courier", "Contul de curier nu este activ."],
  ["not a courier", "Contul nu este înregistrat ca curier."],
  ["no courier on this order", "Comanda nu are un curier asignat."],
  ["delivery proof window has closed", "Dovada de livrare nu mai poate fi adăugată (a trecut o oră de la livrare)."],
  ["delivery proof can only be attached", "Dovada de livrare se poate adăuga doar pe drum sau după livrare."],
  ["invalid proof path", "Fișierul dovezii de livrare nu este valid."],
  // shared
  ["invalid transition", "Comanda și-a schimbat deja starea — reîncarcă pagina."],
  ["invalid payment transition", "Starea plății nu poate fi schimbată astfel."],
  ["authentication required", "Trebuie să fii autentificat."],
  ["not authenticated", "Trebuie să fii autentificat."],
  ["neautentificat", "Trebuie să fii autentificat."],
  ["not authorized", "Nu ai permisiunea pentru această acțiune."],
  ["order not found", "Comanda nu a fost găsită."],
  ["courier not found", "Curierul nu a fost găsit."],
  ["application not found", "Cererea nu a fost găsită."],
  ["cod de recomandare inexistent", "Codul de recomandare nu există."],
  ["un curier nu se poate recomanda singur", "Un curier nu se poate recomanda singur."],
  ["motivul refuzului e obligatoriu", "Motivul refuzului este obligatoriu."],
  ["invalid quote amount", "Suma ofertei nu este validă."],
  ["is below the delivery fee", "Oferta este sub taxa de livrare — partea restaurantului ar fi negativă."],
  ["cannot be delivered before payment is confirmed", "Comanda online nu poate fi livrată înainte de confirmarea plății."],
  ["este disponibil doar pentru catering", "Un produs din coș se comandă doar prin catering."],
  // admin (Romanian written without diacritics in the SQL)
  ["comanda nu are un curier de reatribuit", "Comanda nu are un curier de reatribuit în starea curentă."],
  ["curierul nou nu este disponibil", "Curierul nou nu este disponibil."],
  ["curierul nu este disponibil", "Curierul nu este disponibil."],
  ["ponderile trebuie sa fie >= 0", "Ponderile trebuie să fie ≥ 0."],
  ["suprataxa trebuie sa fie >= 0", "Suprataxa trebuie să fie ≥ 0."],
  ["dispatch_scoring_config este imutabil", "Configurația de dispecerizare nu se modifică pe loc — creează o versiune nouă."],
  ["ledger-ul de payout este imutabil", "O plată decontată nu se mai modifică — corecția se face printr-o tranzacție nouă."],
];

const ROMANIAN_DIACRITICS = /[ăâîșțşţĂÂÎȘȚŞŢ]/;

/** Romanian text for a raw `raise exception` message; null when it is neither known nor Romanian. */
export function romanianRaiseText(raw: string | null | undefined): string | null {
  const msg = raw?.trim();
  if (!msg) return null;
  const lower = msg.toLowerCase();
  const known = KNOWN_ERRORS.find(([needle]) => lower.includes(needle));
  if (known) return known[1];
  return msg.length < 200 && ROMANIAN_DIACRITICS.test(msg) ? msg : null;
}

export function mapPgError(error: PostgrestError): string {
  switch (error.code) {
    case "23505": // unique_violation — e.g. duplicate live offer / double claim
      return "Acțiunea a fost deja efectuată.";
    case "23503": // foreign_key_violation
      return "Elementul nu mai există.";
    case "42501": // insufficient_privilege — e.g. a read-only view-as session ("vezi ca")
      return "Nu ai permisiunea pentru această acțiune.";
    case "P0001":
      // raise exception: known texts are mapped, Romanian ones pass through, anything else
      // (English internals) never reaches the user raw.
      return romanianRaiseText(error.message) ?? "Acțiunea nu a putut fi efectuată.";
    case "PGRST301": // JWT expired
      return "Sesiunea a expirat — intră din nou în cont.";
    case "23514": // check_violation — e.g. a negative price
    case "22P02": // invalid_text_representation
    case "22003": // numeric_value_out_of_range
      return "Valoare invalidă — verifică câmpurile completate.";
    case "23502": // not_null_violation
      return "Lipsește un câmp obligatoriu.";
    default:
      return "A apărut o eroare. Încearcă din nou.";
  }
}

/** GoTrue (auth) errors, e.g. an admin invite: Romanian by code, never the raw English text. */
export function authErrorText(error: { code?: string; message?: string }): string {
  if (error.code === "email_exists" || /already (been )?registered/i.test(error.message ?? "")) {
    return "Există deja un cont cu acest email.";
  }
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return "Emailul nu pare valid.";
  if (error.code === "over_email_send_rate_limit") return "Prea multe emailuri trimise — încearcă din nou peste câteva minute.";
  return "Invitația nu a putut fi trimisă. Încearcă din nou.";
}
