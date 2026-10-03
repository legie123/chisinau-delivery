import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  netForOrder,
  quotedNetMdl,
  summarizeEarnings,
  type EarningsOrder,
} from "@chisinau/shared-domain";

// R8 — al doilea val adversarial pe suprafața CURIERULUI.
//
// Defectul, în cuvinte: produsul are DOUĂ definiții pentru „câștig" și le
// arată pe ecrane diferite, fără să spună vreodată că diferă.
//   · la DECIZIE (ofertă de 30s, listă de comenzi) scria `courier_fee` brut;
//   · la PLATĂ (`/earnings`, payout-ul real) scrie net, după comision.
// `_lib/earnings.ts` e modelul canonic, iar el spune limpede:
//   net = (fee + tip) − round(fee × pct/100)
// Verificat pe rândurile REALE de payout din DB-ul viu, nu doar pe el însuși:
// brut 105,00 / comision 12,75 ⇒ fee 85 + bacșiș 20, adică 15% DOAR pe taxă.
//
// Deci un curier care citea „Câștig: 60 MDL" și apăsa Acceptă era creditat cu
// 51 MDL. Aceeași clasă cu cele trei minciuni reparate în V11 (§5 al rubricii:
// „starea afișată = starea reală"), pe suprafața unde omul decide dacă merită
// să iasă din casă.

const ROOT = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("R8 · câștigul cotat = net, nu brut", () => {
  it("scade comisionul din taxă și lasă bacșișul întreg", () => {
    // 60 MDL taxă la 15% ⇒ 51 net. Bacșișul NU intră în comision (rămâne al lui,
    // deci rămâne un chip separat în UI, exact ca azi).
    expect(quotedNetMdl({ delivery_fee_mdl: 60, courier_fee_quoted_mdl: 60 }, 15)).toBe(51);
    expect(quotedNetMdl({ delivery_fee_mdl: 40, courier_fee_quoted_mdl: null }, 15)).toBe(34);
  });

  it("cotația e o PODEA, deci și netul derivat din ea e o podea", () => {
    // Order 2: `courier_fee_quoted_mdl` e podeaua ștampilată la mark_ready;
    // finalul de la livrare poate fi doar mai mare. Netul urmează aceeași lege.
    const quoted = quotedNetMdl({ delivery_fee_mdl: 30, courier_fee_quoted_mdl: 30 }, 15);
    const finalHigher = quotedNetMdl({ delivery_fee_mdl: 30, courier_fee_quoted_mdl: 44 }, 15);
    expect(finalHigher).toBeGreaterThan(quoted);
  });

  it("urmează comisionul viu, nu o constantă", () => {
    expect(quotedNetMdl({ delivery_fee_mdl: 100, courier_fee_quoted_mdl: 100 }, 40)).toBe(60);
  });

  it("aceeași cursă dă ACELAȘI număr la ofertă și la plată", () => {
    // Contractul valului: ce i se promite la Acceptă e ce i se creditează la
    // livrare (fără bacșiș, care se adaugă separat pe ambele ecrane).
    const fee = 47;
    const atOffer = quotedNetMdl({ delivery_fee_mdl: fee, courier_fee_quoted_mdl: fee }, 15);
    const atPayout = netForOrder(
      { delivery_fee_mdl: fee, courier_fee_mdl: fee, tip_mdl: 0, payment_status: "paid" },
      15,
    );
    expect(atOffer).toBe(atPayout);
  });
});

describe("R8 · „Azi ai câștigat” spune același lucru ca /earnings", () => {
  // Ecranul principal aduna TOATE livrările de azi, indiferent de încasare, și
  // nu scădea comisionul. `/earnings` face exact invers pentru aceleași comenzi
  // și scrie negru pe alb „N livrări neîncasate nu apar aici". Două numere
  // pentru aceleași curse, pe același produs, în aceeași zi.
  const today: EarningsOrder[] = [
    { delivery_fee_mdl: 60, courier_fee_mdl: 60, tip_mdl: 20, payment_status: "paid" },
    { delivery_fee_mdl: 38, courier_fee_mdl: 38, tip_mdl: 0, payment_status: "unpaid" },
  ];

  it("exclude livrarea neîncasată și scade comisionul", () => {
    const s = summarizeEarnings(today, 15);
    expect(s.netMdl).toBe(71); // (60+20) − 9 ; comanda unpaid nu intră deloc
    expect(s.ordersCount).toBe(1);
    expect(s.pendingCount).toBe(1);
    // Cifra veche a ecranului principal era 118 = 60+20+38, brut și cu tot cu
    // banii neîncasați — cu 47 MDL peste ce i se decontează.
    expect(s.netMdl).not.toBe(118);
  });
});

describe("R8 · gardă mecanică: nicio taxă brută vândută drept „Câștig”", () => {
  // În familia lui `courierGold.test.ts` (V5) și `designTokens.test.ts` (V4):
  // un comentariu n-ar fi prins recidiva. Suprafața de DECIZIE nu are voie să
  // pună o taxă brută lângă cuvântul „Câștig".
  const DECISION_SURFACE = [
    "src/components/courier/OfferCard.tsx",
    "src/components/courier/AvailableOrderRow.tsx",
  ];

  // Comentariile se scot ÎNAINTE de scanare, nu se sar rând cu rând. Prima
  // versiune sărea doar rândurile care ÎNCEP cu un marcaj de comentariu, așa
  // că a raportat ca vinovată o frază dintr-un bloc `/* … */` („Câștig must be
  // the primary gold number") — adică proza care EXPLICĂ regula. O gardă care
  // pică din alt motiv decât cel promis e mai rea decât niciuna (lecția V10),
  // deci garda măsoară acum cod, nu text.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");

  for (const file of DECISION_SURFACE) {
    it(`${file}: „Câștig" nu afișează fee brut`, () => {
      const lines = stripComments(read(file)).split("\n");
      const offenders = lines.filter((line, i) => {
        if (!/Câștig/.test(line)) return false;
        // Fereastră, nu rând: în JSX eticheta și valoarea stau des pe rânduri
        // diferite (lecția din `courierGold.test.ts`).
        const window = lines.slice(i, i + 3).join("\n");
        const showsRawFee = /courier_fee_quoted_mdl|delivery_fee_mdl/.test(window);
        const throughNet = /quotedNetMdl|netMdl|netQuoted/.test(window);
        return showsRawFee && !throughNet;
      });
      expect(offenders, `taxă brută sub eticheta „Câștig" în ${file}:\n${offenders.join("\n")}`).toEqual([]);
    });
  }

  it("garda chiar mușcă pe codul vechi (contra-probă)", () => {
    // Fără proba asta, cele două aserturi de mai sus ar trece și dacă regexul
    // ar fi rupt. Aici e exact forma de dinainte de val, scrisă de mână.
    const before = `<p className="text-lg font-bold text-gold">\n  Câștig: {order.courier_fee_quoted_mdl ?? order.delivery_fee_mdl} MDL\n</p>`;
    const lines = stripComments(before).split("\n");
    const offenders = lines.filter((line, i) => {
      if (!/Câștig/.test(line)) return false;
      const window = lines.slice(i, i + 3).join("\n");
      return /courier_fee_quoted_mdl|delivery_fee_mdl/.test(window) && !/quotedNetMdl|netMdl/.test(window);
    });
    expect(offenders).toHaveLength(1);
  });

  it("ecranul principal nu-și mai calculează propriul total de bani", () => {
    // `/deliveries` avea o reducere proprie peste `orders`, paralelă cu modelul
    // canonic. Două formule pentru aceeași întrebare = exact cum au divergat.
    const page = read("src/app/(courier)/deliveries/page.tsx");
    expect(page).toMatch(/summarizeEarnings/);
  });

  it("comisionul afișat vine din configurația vie, nu dintr-o constantă", () => {
    const page = read("src/app/(courier)/deliveries/page.tsx");
    expect(page).toMatch(/current_pricing_config/);
  });
});
