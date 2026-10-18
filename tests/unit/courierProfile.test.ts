import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ibanError, maskIban, normalizeIban } from "../../src/components/courier/payoutIban";

const read = (p: string) => readFileSync(p, "utf8");

// Client rule mirrors the server's is_valid_iban (000402): format, MD = 24 chars, mod-97.
describe("courier web IBAN rule", () => {
  it("accepts a valid MD IBAN with spaces/lowercase and normalises it", () => {
    expect(ibanError("md24 ag00 0225 1000 1310 4168")).toBeNull();
    expect(normalizeIban("md24 ag00 0225 1000 1310 4168")).toBe("MD24AG000225100013104168");
    // Pasted from a bank app: BOM / zero-width space / NEL must vanish, as the server strips \s.
    expect(normalizeIban("\uFEFFMD24\u200BAG00\u00850225100013104168")).toBe("MD24AG000225100013104168");
  });
  it("refuses with a Romanian reason: empty, bad check digit, MD wrong length, junk", () => {
    expect(ibanError("")).toBe("Scrie IBAN-ul.");
    expect(ibanError("MD24AG000225100013104169")).toMatch(/verifică cifrele/);
    expect(ibanError("MD24AG0002251000131041")).toMatch(/24 de caractere/);
    expect(ibanError("12-ab")).toMatch(/litere și cifre/);
  });
  it("masks to first 4 + last 4 only", () => {
    expect(maskIban("MD24AG000225100013104168")).toBe("MD24 •••• 4168");
  });
});

describe("courier web /profile wiring", () => {
  it("layout links to /profile", () => {
    expect(read("src/app/(courier)/layout.tsx")).toMatch(/href="\/profile"/);
  });
  it("the action saves through set_payout_account as a courier, after the client rule", () => {
    const action = read("src/app/(courier)/profile/actions.ts");
    expect(action).toMatch(/rpc\("set_payout_account"/);
    expect(action).toMatch(/p_recipient_type: "courier"/);
    expect(action).toMatch(/ibanError\(/);
  });
  it("the page shows the masked IBAN, the change-is-recorded notice and the configured support line", () => {
    const page = read("src/app/(courier)/profile/page.tsx");
    expect(page).toMatch(/payout_accounts/);
    expect(page).toMatch(/supportPhone\(process\.env\.NEXT_PUBLIC_SUPPORT_PHONE\)/);
    expect(page).toMatch(/<CourierPayoutForm/);
    const form = read("src/components/courier/CourierPayoutForm.tsx");
    expect(form).toMatch(/maskIban\(/);
    expect(form).toMatch(/înregistrat/);
  });
});
