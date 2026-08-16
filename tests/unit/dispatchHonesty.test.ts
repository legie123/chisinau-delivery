import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDeliveryDuration, MIN_DELIVERY_SAMPLE } from "@/lib/ops/dispatchMetrics";

// R9 — al doilea val adversarial pe suprafața ADMIN (ultima nematurată din
// lista lăsată deschisă de V11).
//
// Defectul, în cuvinte: pe `/platform` și pe `/platform/pilot`, „Livrare totală
// medie" era o MEDIE aritmetică peste toate livrările din 7 zile, fără să spună
// niciodată pe câte stă. Pe datele vii ale zilei asta însemna 2872 min — cu o
// țintă de „≤35–49 min" alături și verdictul FAIL scris lângă ea, pe pagina de
// go/no-go a pilotului. Cele șase livrări reale erau:
//   10130,2 · 7071,7 · 15,1 · 7,2 · 5,4 · 0,0  (minute)
// adică patru livrări sub un sfert de oră și două comenzi rămase zile în
// conductă. Mediana e 11,15 min (PASS), media 2871,6 (FAIL) — două verdicte
// opuse de lansare din aceleași șase rânduri, după cum alegi măsura centrală.
//
// Regula casei exista deja de două ori și nu ajunsese aici: `get_prep_estimates`
// cere ≥5 observații înainte de a publica o statistică, iar `20260727001500` a
// scos „turele-scânteie" din mediana KPI-urilor de curier PĂSTRÂND numărul lor
// vizibil (`empty_shifts_14d`). Nimic nu se ascunde: mediana devine cifra
// judecată, media rămâne scrisă lângă ea, iar eșantionul se publică.
const HERE = join(process.cwd(), "src/lib/ops/dispatchMetrics.ts");

describe("formatDeliveryDuration", () => {
  // Cazul viu, cel din captura de dinainte.
  it("judecă pe mediană și publică eșantionul, nu media care sare la 2872", () => {
    const out = formatDeliveryDuration({ medianMinutes: 11.15, avgMinutes: 2871.6, orders: 6 });
    expect(out.display).toBe("11 min");
    expect(out.sample).toBe("6 livrări");
    // Coada lungă NU se ascunde — media rămâne scrisă, cu numărul ei.
    expect(out.tail).toContain("2872");
    expect(out.enoughData).toBe(true);
  });

  it("sub pragul casei nu dă niciun verdict, ci spune de ce", () => {
    const out = formatDeliveryDuration({ medianMinutes: 9, avgMinutes: 9, orders: 4 });
    expect(out.enoughData).toBe(false);
    expect(out.display).toBe("—");
    expect(out.sample).toContain("4");
    expect(out.sample).toMatch(/sub prag|insuficient/i);
  });

  it("pragul e cel al casei (≥5, ca la get_prep_estimates)", () => {
    expect(MIN_DELIVERY_SAMPLE).toBe(5);
    expect(formatDeliveryDuration({ medianMinutes: 9, avgMinutes: 9, orders: 5 }).enoughData).toBe(true);
  });

  it("fără nicio livrare nu inventează zero", () => {
    const out = formatDeliveryDuration({ medianMinutes: null, avgMinutes: null, orders: 0 });
    expect(out.display).toBe("—");
    expect(out.enoughData).toBe(false);
  });

  // Media care NU e departe de mediană nu merită o propoziție despre coadă:
  // altfel fiecare tile ar căra un avertisment care nu spune nimic.
  it("nu scrie despre coadă când media și mediana sunt de acord", () => {
    const out = formatDeliveryDuration({ medianMinutes: 28, avgMinutes: 30, orders: 40 });
    expect(out.tail).toBeNull();
  });
});

describe("migrația care alimentează cifra", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260816000100_dispatch_median_sample.sql"),
    "utf8",
  );

  it("publică mediana și eșantionul, nu doar media", () => {
    expect(migration).toContain("total_delivery_median_minutes");
    expect(migration).toContain("total_delivery_orders");
    // Media veche rămâne — o coloană ștearsă ar ascunde exact cozile lungi.
    expect(migration).toContain("total_delivery_avg_minutes");
  });

  it("go/no-go judecă mediana și refuză verdictul sub prag", () => {
    expect(migration).toMatch(/total_delivery_median_minutes/);
    expect(migration).toMatch(/no_data/);
  });
});

describe("unealta nu se poate ocoli", () => {
  it("pragul e definit o singură dată, nu retipărit la fiecare apel", () => {
    const src = readFileSync(HERE, "utf8");
    // Un „5" scris de mână în corpul funcției ar fi al doilea adevăr.
    expect(src.match(/MIN_DELIVERY_SAMPLE/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
