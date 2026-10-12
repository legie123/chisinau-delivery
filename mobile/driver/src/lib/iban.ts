// IBAN checks for the courier's payout account. The server (set_payout_account -> is_valid_iban) is the
// authority; this mirrors it so the courier gets a precise Romanian reason instead of a generic
// "the action failed" (the server's "IBAN invalid" has no Romanian mapping). Pure, so vitest runs it.

export function normalizeIban(raw: string): string {
  return raw.replace(/\s/g, "").toUpperCase();
}

// ISO 13616 mod-97: move the first 4 chars to the end, letters -> 10..35, remainder must be 1.
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem;
}

export function ibanError(raw: string): string | null {
  const iban = normalizeIban(raw);
  if (!iban) return "Scrie IBAN-ul.";
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) {
    return "IBAN-ul are doar litere și cifre și începe cu codul țării (ex. MD…).";
  }
  if (iban.startsWith("MD") && iban.length !== 24) return "Un IBAN din Moldova are 24 de caractere.";
  if (iban.length < 15 || iban.length > 34) return "Lungimea IBAN-ului nu e validă.";
  if (mod97(iban) !== 1) return "IBAN-ul nu e valid — verifică cifrele.";
  return null;
}

export function holderError(raw: string): string | null {
  return raw.trim() ? null : "Scrie numele titularului contului.";
}

/** "MD24 •••• 4168" — enough to recognise the account, not enough to copy it off a screen. */
export function maskIban(iban: string): string {
  const n = normalizeIban(iban);
  return `${n.slice(0, 4)} •••• ${n.slice(-4)}`;
}
