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

export function mapPgError(error: PostgrestError): string {
  switch (error.code) {
    case "23505": // unique_violation — e.g. duplicate live offer / double claim
      return "Acțiunea a fost deja efectuată.";
    case "23503": // foreign_key_violation
      return "Elementul nu mai există.";
    case "P0001": {
      // raise exception — the RPC's own message is already Romanian-friendly for
      // the guarded paths; surface it, with a safe fallback.
      const msg = error.message?.trim();
      return msg && msg.length < 200 ? msg : "Acțiunea nu a putut fi efectuată.";
    }
    case "PGRST301": // JWT expired
      return "Sesiunea a expirat — intră din nou în cont.";
    default:
      return "A apărut o eroare. Încearcă din nou.";
  }
}
