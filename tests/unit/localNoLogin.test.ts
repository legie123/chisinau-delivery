import { afterEach, describe, expect, it } from "vitest";
import { isLocalRequestHost, localNoLoginActive, localNoLoginFlag } from "@/lib/local/noLogin";

const original = process.env.LOCAL_NO_LOGIN;
afterEach(() => {
  if (original === undefined) delete process.env.LOCAL_NO_LOGIN;
  else process.env.LOCAL_NO_LOGIN = original;
});

describe("localNoLoginFlag", () => {
  it("cere exact «1» — orice altă valoare înseamnă oprit", () => {
    for (const value of ["true", "TRUE", "yes", "0", "", " 1"]) {
      process.env.LOCAL_NO_LOGIN = value;
      expect(localNoLoginFlag(), `valoarea ${JSON.stringify(value)}`).toBe(false);
    }
    process.env.LOCAL_NO_LOGIN = "1";
    expect(localNoLoginFlag()).toBe(true);
  });

  it("lipsa variabilei înseamnă oprit", () => {
    delete process.env.LOCAL_NO_LOGIN;
    expect(localNoLoginFlag()).toBe(false);
  });
});

describe("isLocalRequestHost", () => {
  it("acceptă mașina asta, cu și fără port", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3007", "LocalHost:3000"]) {
      expect(isLocalRequestHost(host), host).toBe(true);
    }
  });

  it("acceptă IPv6 fără să rupă adresa la primele două puncte", () => {
    // Un split(":")[0] naiv ar întoarce "[" și ar refuza o cerere locală reală.
    expect(isLocalRequestHost("[::1]:3000")).toBe(true);
    expect(isLocalRequestHost("[::1]")).toBe(true);
  });

  it("refuză un domeniu care doar ÎNCEPE cu localhost", () => {
    // Motivul comparației exacte: startsWith ar deschide poarta aici.
    expect(isLocalRequestHost("localhost.atacator.example")).toBe(false);
    expect(isLocalRequestHost("127.0.0.1.atacator.example")).toBe(false);
  });

  it("refuză host public, IP de rețea locală și antet lipsă", () => {
    for (const host of ["dragonsdelivery.md", "192.168.1.40:3000", "0.0.0.0", "", null, undefined]) {
      expect(isLocalRequestHost(host), String(host)).toBe(false);
    }
  });
});

describe("localNoLoginActive", () => {
  it("cere AMBELE condiții — flagul singur nu deschide un host public", () => {
    process.env.LOCAL_NO_LOGIN = "1";
    expect(localNoLoginActive("localhost:3000")).toBe(true);
    // Scenariul de care există a doua condiție: flagul scapă într-un deploy.
    expect(localNoLoginActive("dragonsdelivery.md")).toBe(false);
  });

  it("localhost singur nu deschide nimic fără consimțământ explicit", () => {
    delete process.env.LOCAL_NO_LOGIN;
    expect(localNoLoginActive("localhost:3000")).toBe(false);
  });
});
