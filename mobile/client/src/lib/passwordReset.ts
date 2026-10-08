import { loginErrorText } from "./errors";

// Password reset by emailed CODE, not link: a recovery link would need a deep link back into
// the app, which Expo Go cannot receive. The recovery email carries {{ .Token }} (template in
// supabase/templates/recovery.html). Flow: resetPasswordForEmail -> verifyOtp(type recovery),
// which signs the user in -> updateUser({ password }).
// Takes the auth client as a parameter so the logic is testable without React Native.

type AuthResult = Promise<{ error: { message: string } | null }>;
export interface ResetAuth {
  resetPasswordForEmail(email: string): AuthResult;
  verifyOtp(params: { email: string; token: string; type: "recovery" }): AuthResult;
  updateUser(attrs: { password: string }): AuthResult;
}

// Mirrors supabase/config.toml [auth] minimum_password_length; checked here only so a short
// password is refused BEFORE verifyOtp consumes the one-time code. The server stays authoritative.
export const MIN_PASSWORD_LENGTH = 6;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sends the reset code. Returns a Romanian error, or null. GoTrue answers the same for an
 *  unknown email (no account enumeration), so null means "sent if the account exists". */
export async function requestResetCode(auth: ResetAuth, email: string): Promise<string | null> {
  const e = email.trim();
  if (!EMAIL_RE.test(e)) return "Emailul nu pare valid.";
  const { error } = await auth.resetPasswordForEmail(e);
  return error ? loginErrorText(error.message) : null;
}

/** Keeps only digits: pasted codes often carry spaces. */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Verifies the code (unless an earlier attempt already did) and sets the new password.
 *  `verified` comes back true once the code is spent, so a retry after a rejected password
 *  skips verifyOtp — the code is single-use and a second verify would fail as "expired". */
export async function confirmReset(
  auth: ResetAuth,
  input: { email: string; code: string; password: string; verified: boolean },
): Promise<{ error: string | null; verified: boolean }> {
  const { verified, password } = input;
  const digits = cleanCode(input.code);
  if (!verified && digits.length < 6) return { error: "Introdu codul de 6 cifre din email.", verified };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Parola trebuie să aibă minim ${MIN_PASSWORD_LENGTH} caractere.`, verified };
  }
  if (!verified) {
    const { error } = await auth.verifyOtp({ email: input.email.trim(), token: digits, type: "recovery" });
    if (error) return { error: loginErrorText(error.message), verified: false };
  }
  const { error } = await auth.updateUser({ password });
  if (error) return { error: loginErrorText(error.message), verified: true };
  return { error: null, verified: true };
}
