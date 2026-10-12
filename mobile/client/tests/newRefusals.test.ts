// The place_order refusals added on 2026-10-12 must reach the customer as written (Romanian,
// actionable), never as the generic fallback: price changed (sim 100), retry with another total
// (sim 106), no pin / outside the zone (sim 102), sold out (sim 101).
import { describe, expect, it } from "vitest";
import { errorText } from "../src/lib/errors";

const FALLBACK = "Nu am putut trimite comanda. Încearcă din nou.";
const cases: [string, RegExp][] = [
  ["prețul s-a schimbat: totalul este acum 300 MDL", /totalul este acum 300 MDL/],
  ["comanda a fost deja plasată cu alt total (CHD-2026-000123) — o găsești la Comenzi", /deja plasată.*CHD-2026-000123/],
  ["fixează pinul adresei pe hartă — curierul trebuie să știe exact unde livrează", /pinul/],
  ["adresa este în afara zonei de livrare a restaurantului (10 km)", /în afara zonei.*10 km/],
  ["produsul „Set Sakura” este epuizat momentan — scoate-l din coș", /Set Sakura.*epuizat/],
];

describe("new place_order refusals reach the customer", () => {
  for (const [raw, shown] of cases) {
    it(raw.slice(0, 40), () => {
      const text = errorText(new Error(raw), FALLBACK);
      expect(text).not.toBe(FALLBACK);
      expect(text).toMatch(shown);
    });
  }
});
