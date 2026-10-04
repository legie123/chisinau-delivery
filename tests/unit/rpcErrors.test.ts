import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authErrorText, mapPgError, RpcError, storageErrorText } from "@chisinau/shared-api";

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

// Partner and admin actions returned `{ error: error.message }`: raw English Postgres/GoTrue text
// ("new row violates check constraint …", "A user with this email address has already been
// registered") on Romanian screens (client verifier, 2026-10-04). Class guard: no server action
// hands a supabase error's .message to the user; it goes through mapPgError / authErrorText.
describe("server actions never return a raw supabase error message", () => {
  it("no `{ error: <x>Error.message }` in src/app/**/actions.ts", () => {
    const root = path.join(__dirname, "../../src/app");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/actions\.ts$/.test(e.name)) {
          readFileSync(p, "utf8").split("\n").forEach((l, i) => {
            if (/\{ error: \w*[eE]rror\.message \}/.test(l)) hits.push(`${path.relative(root, p)}:${i + 1}`);
          });
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });

  it("GoTrue invite errors and constraint errors are Romanian", () => {
    expect(authErrorText({ code: "email_exists", message: "A user with this email address has already been registered" })).toBe(
      "Există deja un cont cu acest email.",
    );
    expect(authErrorText({ message: "A user with this email address has already been registered" })).toBe("Există deja un cont cu acest email.");
    expect(authErrorText({ message: "Database error saving new user" })).toMatch(/^Invitația nu a putut fi trimisă/);
    const pg = (code: string, message: string) => mapPgError({ code, message, details: "", hint: "", name: "PostgrestError" } as never);
    expect(pg("23514", 'new row for relation "menu_items" violates check constraint "menu_items_price_mdl_check"')).toBe(
      "Valoare invalidă — verifică câmpurile completate.",
    );
    expect(pg("23502", 'null value in column "name" violates not-null constraint')).toBe("Lipsește un câmp obligatoriu.");
    // a duplicate slug used to read "Acțiunea a fost deja efectuată." — the admin left, no restaurant existed
    expect(pg("23505", 'duplicate key value violates unique constraint "restaurants_slug_key"')).toMatch(/^Slug-ul este deja folosit/);
    expect(pg("23505", 'duplicate key value violates unique constraint "dispatch_offers_one_live_per_order"')).toBe("Acțiunea a fost deja efectuată.");
  });
});

// Round 2: the same leak outside actions.ts — a read error rendered as `{error.message}`, a storage
// upload error shown via setError(uploadError.message) or thrown verbatim, a `?e=` redirect param.
describe("screens never render a raw supabase error message", () => {
  // `(?<!\$)`: a template literal `${error.message}` in a server log line is not a screen.
  const RAW = /(?<!\$)\{\s*(error|\w+Error|\w+Res\.error)\.message\s*\}|searchParams\.set\([^)]*\.message\)|set(Error|Status)\((error|\w+Error)\.message\)/;
  it("no raw .message in JSX, setError or redirect params under src/ and apps/", () => {
    const repo = path.join(__dirname, "../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", "graphify-out"].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          readFileSync(p, "utf8").split("\n").forEach((l, i) => {
            if (RAW.test(l)) hits.push(`${path.relative(repo, p)}:${i + 1}`);
          });
        }
      }
    };
    walk(path.join(repo, "src"));
    walk(path.join(repo, "apps"));
    expect(hits).toEqual([]);
  });

  it("storage upload errors are Romanian", () => {
    expect(storageErrorText({ message: "The object exceeded the maximum allowed size", statusCode: "413" })).toBe("Fișierul e prea mare.");
    expect(storageErrorText({ message: "mime type image/gif is not supported" })).toBe("Formatul fișierului nu e acceptat.");
    expect(storageErrorText({ message: "new row violates row-level security policy", statusCode: "403" })).toMatch(/permisiunea/);
    expect(storageErrorText({ message: "fetch failed" })).toMatch(/^Încărcarea a eșuat/);
  });
});
