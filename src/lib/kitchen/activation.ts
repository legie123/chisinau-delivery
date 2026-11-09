// Partner portal activation (/restaurant/activare): the invite / recovery link lands here with
// the session in the URL fragment; the page sets the password. Pure helpers, no React, so the
// Romanian text is testable. Mirrors mobile/client/src/lib/passwordReset.ts (not imported:
// mobile/ <-> src/ never cross).

// Mirrors supabase/config.toml [auth] minimum_password_length — refused here first, server stays authoritative.
export const MIN_PASSWORD_LENGTH = 6;

const LINK_DEAD = "Linkul de activare a expirat sau a fost deja folosit. Cere o invitație nouă.";

/** Romanian error for the form, or null when the pair is acceptable. */
export function validatePassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Parola trebuie să aibă minim ${MIN_PASSWORD_LENGTH} caractere.`;
  if (password !== confirm) return "Parolele nu coincid.";
  return null;
}

/** GoTrue updateUser / session error text -> the same Romanian lines LoginForm shows. */
export function mapActivationError(raw: string): string {
  if (raw.includes("should be different from the old password")) return "Parola nouă trebuie să fie diferită de cea veche.";
  if (raw.includes("at least 6 characters") || raw.includes("Password should")) return "Parola trebuie să aibă minim 6 caractere.";
  if (/session missing|invalid or has expired|otp_expired|token has expired or is invalid/i.test(raw)) return LINK_DEAD;
  if (/rate limit|too many|for security purposes/i.test(raw)) return "Prea multe încercări — încearcă din nou peste câteva minute.";
  if (/network|fetch/i.test(raw)) return "Nu ne-am putut conecta. Verifică internetul și încearcă din nou.";
  return "A apărut o eroare. Încearcă din nou.";
}

/** GoTrue puts a failed verify in the fragment (`#error=...&error_code=otp_expired&error_description=...`)
 *  instead of a session; supabase-js swallows it at init, so the page reads it itself. */
export function activationHashError(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("error_code");
  const description = params.get("error_description");
  if (!code && !description && !params.get("error")) return null;
  return mapActivationError(`${code ?? ""} ${description ?? ""}`);
}
