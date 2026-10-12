import { describe, expect, it } from "vitest";
import { supportPhone } from "@chisinau/shared-domain";

// The support number shown to customers comes from build config (EXPO_PUBLIC_SUPPORT_PHONE /
// NEXT_PUBLIC_SUPPORT_PHONE). The hardcoded "+373 60 000 000" was a placeholder customers could
// dial; without a real configured number we show NO phone, never a fake one.
describe("supportPhone", () => {
  it("formats a Moldovan mobile into a label and a tel: link", () => {
    expect(supportPhone("+37369123456")).toEqual({ label: "+373 69 123 456", tel: "tel:+37369123456" });
    expect(supportPhone("069 123 456")).toEqual({ label: "+373 69 123 456", tel: "tel:+37369123456" });
  });

  it("no number, garbage or the old placeholder → null (show e-mail only)", () => {
    expect(supportPhone(undefined)).toBeNull();
    expect(supportPhone("")).toBeNull();
    expect(supportPhone("abc")).toBeNull();
    expect(supportPhone("+373 60 000 000")).toBeNull();
  });
});
