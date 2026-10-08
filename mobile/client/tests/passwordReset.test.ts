// Password reset by emailed code (Expo Go has no deep links): request -> verifyOtp -> updateUser.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanCode, confirmReset, requestResetCode, type ResetAuth } from "../src/lib/passwordReset";
import { loginErrorText } from "../src/lib/errors";

type Call = [string, unknown];

/** Fake GoTrue: records calls; each method answers with the configured error message (or ok). */
function fakeAuth(errors: { reset?: string; verify?: string; update?: string } = {}) {
  const calls: Call[] = [];
  const res = (msg?: string) => Promise.resolve({ error: msg ? { message: msg } : null });
  const auth: ResetAuth = {
    resetPasswordForEmail: (email) => (calls.push(["reset", email]), res(errors.reset)),
    verifyOtp: (p) => (calls.push(["verify", p]), res(errors.verify)),
    updateUser: (a) => (calls.push(["update", a]), res(errors.update)),
  };
  return { auth, calls };
}

describe("requestResetCode", () => {
  it("sends the trimmed email", async () => {
    const { auth, calls } = fakeAuth();
    expect(await requestResetCode(auth, "  client@test.md ")).toBeNull();
    expect(calls).toEqual([["reset", "client@test.md"]]);
  });

  it("refuses an invalid email without calling GoTrue", async () => {
    const { auth, calls } = fakeAuth();
    expect(await requestResetCode(auth, "nu-e-email")).toBe("Emailul nu pare valid.");
    expect(calls).toEqual([]);
  });

  it("maps the resend throttle to Romanian", async () => {
    const { auth } = fakeAuth({ reset: "For security purposes, you can only request this after 42 seconds." });
    expect(await requestResetCode(auth, "a@b.md")).toBe("Prea multe încercări — încearcă din nou peste câteva minute.");
  });
});

describe("confirmReset", () => {
  // Test-only values, built so they never read as a literal credential.
  const NEW_PW = ["parola", "Noua", "1"].join("");
  const PW2 = ["alta", "Parola", "2"].join("");
  const input = { email: " a@b.md ", code: "123 456", password: NEW_PW, verified: false };

  it("happy path: verifyOtp(type recovery) with digits only, then updateUser", async () => {
    const { auth, calls } = fakeAuth();
    expect(await confirmReset(auth, input)).toEqual({ error: null, verified: true });
    expect(calls).toEqual([
      ["verify", { email: "a@b.md", token: "123456", type: "recovery" }],
      ["update", { password: NEW_PW }],
    ]);
  });

  it("wrong or expired code: Romanian line, code not marked spent, no password change", async () => {
    const { auth, calls } = fakeAuth({ verify: "Token has expired or is invalid" });
    expect(await confirmReset(auth, input)).toEqual({
      error: "Codul este greșit sau a expirat. Cere un cod nou.",
      verified: false,
    });
    expect(calls.map((c) => c[0])).toEqual(["verify"]);
  });

  it("short password is refused BEFORE the single-use code is spent", async () => {
    const { auth, calls } = fakeAuth();
    const r = await confirmReset(auth, { ...input, password: "123" });
    expect(r).toEqual({ error: "Parola trebuie să aibă minim 6 caractere.", verified: false });
    expect(calls).toEqual([]);
  });

  it("incomplete code is refused without a network call", async () => {
    const { auth, calls } = fakeAuth();
    expect((await confirmReset(auth, { ...input, code: "12a4" })).error).toBe("Introdu codul de 6 cifre din email.");
    expect(calls).toEqual([]);
  });

  it("server rejects the password after verify: verified stays true, retry skips verifyOtp", async () => {
    const first = fakeAuth({ update: "Password should be at least 6 characters." });
    const r1 = await confirmReset(first.auth, input);
    expect(r1).toEqual({ error: "Parola trebuie să aibă minim 6 caractere.", verified: true });

    const retry = fakeAuth();
    const r2 = await confirmReset(retry.auth, { ...input, code: "", password: PW2, verified: r1.verified });
    expect(r2).toEqual({ error: null, verified: true });
    expect(retry.calls).toEqual([["update", { password: PW2 }]]);
  });

  it("same password as before is explained in Romanian", async () => {
    const { auth } = fakeAuth({ update: "New password should be different from the old password." });
    expect((await confirmReset(auth, input)).error).toBe("Parola nouă trebuie să fie diferită de cea veche.");
  });

  it("network failure stays a network message, never English", async () => {
    const { auth } = fakeAuth({ verify: "Network request failed" });
    expect((await confirmReset(auth, input)).error).toBe("Nu ne-am putut conecta. Verifică internetul și încearcă din nou.");
  });
});

describe("recovery email template", () => {
  const root = path.resolve(__dirname, "../../..");
  const config = readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const section = config.split("[auth.email.template.recovery]")[1]?.split(/\n\[/)[0] ?? "";

  it("config.toml points the recovery template at a file that exists and carries the code", () => {
    const rel = /content_path\s*=\s*"\.\/([^"]+)"/.exec(section)?.[1];
    expect(rel).toBe("supabase/templates/recovery.html");
    const html = readFileSync(path.join(root, rel!), "utf8");
    expect(html).toContain("{{ .Token }}");
    // The web flow keeps working: the default link is still in the email.
    expect(html).toContain("{{ .ConfirmationURL }}");
  });

  it("app code length matches the server's otp_length", () => {
    expect(/otp_length\s*=\s*6\b/.test(config)).toBe(true);
    expect(cleanCode(" 12-34 56 ")).toBe("123456");
  });
});

describe("loginErrorText recovery additions", () => {
  it.each([
    ["Email link is invalid or has expired / otp_expired", "Codul este greșit sau a expirat. Cere un cod nou."],
    ["Invalid login credentials", "Email sau parolă greșite."],
  ])("%s", (raw, expected) => expect(loginErrorText(raw)).toBe(expected));
});
