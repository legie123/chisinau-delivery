import { describe, expect, it } from "vitest";
import { mapPgError, RpcError } from "@chisinau/shared-api";

const p0001 = (message: string) => ({ code: "P0001", message, details: "", hint: "", name: "PostgrestError" }) as never;

// Every user-facing string is Romanian (CLAUDE.md). P0001 used to pass the RPC's raw
// `raise exception` text through, so web actions showed "too late to cancel" and friends.
describe("mapPgError P0001 → Romanian for every surface", () => {
  it("maps known English raise texts", () => {
    expect(mapPgError(p0001("too late to cancel"))).toMatch(/nu mai poate fi anulată/);
    expect(mapPgError(p0001("invalid transition from en_route to accepted"))).toMatch(/schimbat deja starea/);
    expect(mapPgError(p0001("you already have an active delivery"))).toBe("Ai deja o livrare în curs.");
    expect(new RpcError(p0001("too late to tip")).userMessage).toMatch(/Bacșișul/);
  });

  it("gives diacritic-less Romanian texts their proper spelling", () => {
    expect(mapPgError(p0001("comanda nu mai este disponibila"))).toBe("Comanda nu mai este disponibilă.");
  });

  it("passes Romanian texts with diacritics through, and never leaks unknown English", () => {
    expect(mapPgError(p0001("Restaurantul este închis la ora 23:30."))).toBe("Restaurantul este închis la ora 23:30.");
    expect(mapPgError(p0001("some internal invariant failed: x=3"))).toBe("Acțiunea nu a putut fi efectuată.");
  });
});

describe("diacritic-less Romanian admin texts keep their meaning", () => {
  it("does not turn an informative admin error into the generic line", () => {
    expect(mapPgError(p0001("comanda nu are un curier de reatribuit (stare delivered)"))).toMatch(/reatribuit/);
    expect(mapPgError(p0001("curierul nou nu este disponibil"))).toBe("Curierul nou nu este disponibil.");
    expect(mapPgError(p0001("ledger-ul de payout este imutabil — doar reversed_at poate fi setat post-decontare"))).toMatch(/decontată/);
    expect(mapPgError(p0001("curierul are deja o livrare activă"))).toBe("curierul are deja o livrare activă");
  });
});
