import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { holderError, ibanError, maskIban, normalizeIban } from "../src/lib/iban";

const src = (f: string) => readFileSync(path.join(path.resolve(__dirname, ".."), f), "utf8");
const VALID_MD = "MD24AG000225100013104168"; // IBAN registry example; the server's is_valid_iban accepts it

describe("normalizeIban (same as set_payout_account: upper case, no whitespace)", () => {
  it("strips spaces and upper-cases", () => {
    expect(normalizeIban(" md24 ag00 0225 1000 1310 4168 ")).toBe(VALID_MD);
  });
});

describe("ibanError (mirrors the server so the courier gets a precise Romanian reason)", () => {
  it("accepts a valid Moldovan IBAN, also typed with spaces / lower case", () => {
    expect(ibanError(VALID_MD)).toBeNull();
    expect(ibanError("md24 ag00 0225 1000 1310 4168")).toBeNull();
  });
  it("rejects a wrong check digit", () => {
    expect(ibanError("MD25AG000225100013104168")).toMatch(/verifică/);
  });
  it("rejects a Moldovan IBAN that is not 24 characters", () => {
    expect(ibanError("MD24AG00022510001310416")).toMatch(/24/);
  });
  it("rejects empty input and characters that cannot be in an IBAN", () => {
    expect(ibanError("")).toMatch(/Scrie/);
    expect(ibanError("MD24-AG00/0225")).toMatch(/litere și cifre/);
  });
});

describe("holderError / maskIban", () => {
  it("needs a holder name", () => {
    expect(holderError("  ")).toMatch(/titular/);
    expect(holderError("Ion Popescu")).toBeNull();
  });
  it("shows only the country, check digits and the last 4 characters", () => {
    expect(maskIban(VALID_MD)).toBe("MD24 •••• 4168");
  });
});

describe("wiring: Profile -> form -> RPC", () => {
  it("the 'Cont bancar' row opens the payout form (no longer a dead row)", () => {
    const s = src("src/screens/ProfileScreen.tsx");
    expect(s).toMatch(/label: 'Cont bancar'[^\n]*action: 'payout'/);
    expect(s).toMatch(/case 'payout':\s*if \(profile\) setPayoutOpen\(\(o\) => !o\);/);
    expect(s).toMatch(/<PayoutAccountForm courierId=\{profile\.id\}/);
  });
  it("the form validates before saving and saves through savePayoutAccount", () => {
    const s = src("src/components/PayoutAccountForm.tsx");
    expect(s).toMatch(/const problem = ibanError\(iban\) \?\? holderError\(holder\);/);
    expect(s).toMatch(/if \(problem\) \{/);
    expect(s).toMatch(/savePayoutAccount\(courierId, iban, holder\)/);
  });
  it("api.ts calls set_payout_account for THIS courier and reads only its own row", () => {
    const s = src("src/lib/api.ts");
    expect(s).toMatch(/rpc\("set_payout_account", \{\s*p_recipient_type: "courier",\s*p_recipient_id: courierId,/);
    expect(s).toMatch(
      /\.from\("payout_accounts"\)\s*\.select\("iban, holder_name"\)\s*\.eq\("recipient_type", "courier"\)\s*\.eq\("recipient_id", courierId\)/,
    );
  });
});
