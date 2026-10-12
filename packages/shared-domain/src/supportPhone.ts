// Customer support phone, from build config (EXPO_PUBLIC_SUPPORT_PHONE on mobile,
// NEXT_PUBLIC_SUPPORT_PHONE on web). Accepts +373XXXXXXXX or 0XXXXXXXX (spaces allowed).
// Anything else — unset, malformed, or the old "+373 60 000 000" placeholder — is null, and the
// apps then show the e-mail only: a fake number a customer can dial is worse than none.
const PLACEHOLDER = "37360000000";

export function supportPhone(raw: string | null | undefined): { label: string; tel: string } | null {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  const national = digits.startsWith("373") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : null;
  if (!national || !/^\d{8}$/.test(national)) return null;
  const full = `373${national}`;
  if (full === PLACEHOLDER) return null;
  return {
    label: `+373 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`,
    tel: `tel:+${full}`,
  };
}
