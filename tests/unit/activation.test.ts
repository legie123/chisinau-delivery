import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  activationHashError,
  mapActivationError,
  validatePassword,
} from "@/lib/kitchen/activation";

describe("validatePassword", () => {
  it("refuză parola scurtă înainte de a atinge GoTrue", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(validatePassword("abc12", "abc12")).toBe("Parola trebuie să aibă minim 6 caractere.");
  });
  it("refuză confirmarea diferită", () => {
    expect(validatePassword("abc123", "abc124")).toBe("Parolele nu coincid.");
  });
  it("acceptă parola validă confirmată", () => {
    expect(validatePassword("abc123", "abc123")).toBeNull();
  });
});

describe("mapActivationError", () => {
  it("traduce erorile GoTrue în română (aceleași linii ca LoginForm)", () => {
    expect(mapActivationError("Password should be at least 6 characters.")).toBe(
      "Parola trebuie să aibă minim 6 caractere.",
    );
    expect(mapActivationError("New password should be different from the old password.")).toBe(
      "Parola nouă trebuie să fie diferită de cea veche.",
    );
    expect(mapActivationError("Auth session missing!")).toBe(
      "Linkul de activare a expirat sau a fost deja folosit. Cere o invitație nouă.",
    );
    expect(mapActivationError("Email link is invalid or has expired")).toBe(
      "Linkul de activare a expirat sau a fost deja folosit. Cere o invitație nouă.",
    );
    expect(mapActivationError("For security purposes, you can only request this after 5 seconds.")).toBe(
      "Prea multe încercări — încearcă din nou peste câteva minute.",
    );
    expect(mapActivationError("TypeError: Failed to fetch")).toBe(
      "Nu ne-am putut conecta. Verifică internetul și încearcă din nou.",
    );
    expect(mapActivationError("something unknown")).toBe("A apărut o eroare. Încearcă din nou.");
  });
});

describe("activationHashError", () => {
  it("citește eroarea pusă de GoTrue în fragment (link expirat)", () => {
    expect(
      activationHashError("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"),
    ).toBe("Linkul de activare a expirat sau a fost deja folosit. Cere o invitație nouă.");
  });
  it("fragment cu sesiune sau gol = nicio eroare", () => {
    expect(activationHashError("#access_<REDACTAT-DE-GARDA:credential in clar>")).toBeNull();
    expect(activationHashError("")).toBeNull();
  });
});
