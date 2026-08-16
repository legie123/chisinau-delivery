import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { paymentPresence } from "@/lib/orders/payment";

// Regula 5 a rubricii (`docs/DESIGN-IMERSIV-4-SECTOARE.md`): „Nicio etichetă care
// minte. Starea afișată = starea reală, întotdeauna."
//
// V11 a aplicat regula pe suprafața partenerului și a lăsat scris în issues.md că
// restul suprafețelor n-au fost măturate. Pe client, minciuna stătea pe bani:
// cardul de sume scria `Total ({PAYMENT_METHOD_LABEL[payment_method]})`, iar
// eticheta metodei `online_gateway` e „plătit online" — un verb la trecut, adică
// o AFIRMAȚIE despre plată, pusă fără să citească nimeni `payment_status`.
//
// Stările de mai jos nu sunt inventate. Sunt exact rândurile din DB-ul viu la
// 2026-08-16 (`select ... from orders where payment_method='online_gateway'`):
//
//   CHD-2026-000011  delivered  refunded         1000.00   ← 1000 MDL înapoiați, ecranul tăcea
//   CHD-2026-000015  cancelled  refunded          475.00
//   CHD-2026-000002  cancelled  pending_capture   425.00   ← bani blocați, nu încasați
//   CHD-2026-000014  rejected   failed            400.00   ← plata a EȘUAT, scria „plătit online"
//   CHD-2026-000013  cancelled  unpaid            435.00
//   CHD-2026-000003  cancelled  unpaid            652.00
//
// Șase din nouă comenzi online afișau o pretenție de plată pe care DB-ul o
// contrazicea. Datele erau deja pe client (pagina face `select("*")`, iar
// `useOrderRealtime` aduce rândul întreg la fiecare schimbare) — lipsea doar
// să fie citite, exact ca la V11.

const ROOT = join(import.meta.dirname, "../..");

describe("paymentPresence — ce scrie lângă Total", () => {
  it("nu pretinde că s-a plătit când plata a eșuat", () => {
    // CHD-2026-000014: rejected + failed. Vechiul cod scria „plătit online".
    const p = paymentPresence({ method: "online_gateway", status: "failed", orderStatus: "rejected" });
    expect(p.settled).toBe(false);
    expect(p.totalLabel).not.toContain("plătit");
    expect(p.notice?.tone).toBe("warning");
  });

  it("spune că banii au fost returnați, cu suma", () => {
    // CHD-2026-000011: delivered + refunded + 1000 MDL. Ecranul arăta „Livrată cu
    // succes" și „Total (plătit online) 1000 MDL" — nicio vorbă despre returnare.
    const p = paymentPresence({ method: "online_gateway", status: "refunded", orderStatus: "delivered" });
    expect(p.settled).toBe(false);
    expect(p.notice).not.toBeNull();
    expect(p.notice?.tone).toBe("good");
    expect(p.notice?.label.toLowerCase()).toContain("returna");
    expect(p.chip).not.toBeNull();
  });

  it("distinge returnarea încheiată de cea în curs", () => {
    const done = paymentPresence({ method: "online_gateway", status: "refunded", orderStatus: "cancelled" });
    const inFlight = paymentPresence({ method: "online_gateway", status: "refund_pending", orderStatus: "cancelled" });
    expect(done.notice?.tone).toBe("good");
    expect(inFlight.notice?.tone).toBe("warning");
    expect(done.totalLabel).not.toBe(inFlight.totalLabel);
  });

  it("nu numeste incasat un card doar rezervat", () => {
    // CHD-2026-000002: pending_capture. Banii sunt blocați pe card, nu luați.
    const p = paymentPresence({ method: "online_gateway", status: "pending_capture", orderStatus: "cancelled" });
    expect(p.settled).toBe(false);
    expect(p.notice).not.toBeNull();
    expect(p.chip).not.toBeNull();
  });

  it("liniștește clientul când comanda a picat și nu s-a luat niciun ban", () => {
    // CHD-2026-000013 / 000003: cancelled + unpaid. Aici tăcerea costă invers —
    // omul se întreabă dacă a fost taxat.
    const p = paymentPresence({ method: "online_gateway", status: "unpaid", orderStatus: "cancelled" });
    expect(p.notice?.tone).toBe("good");
    expect(p.settled).toBe(false);
  });

  it("avertizează când o comandă VIE stă cu plata online nefinalizată", () => {
    // `advance_delivery_status` are poartă: o comandă online nu poate fi livrată
    // dacă `payment_status <> 'paid'` (migrația 20260725000100). Deci asta nu e
    // un detaliu contabil — e motivul pentru care mâncarea nu va veni niciodată.
    const p = paymentPresence({ method: "online_gateway", status: "unpaid", orderStatus: "accepted" });
    expect(p.settled).toBe(false);
    expect(p.notice?.tone).toBe("warning");
    expect(p.chip).not.toBeNull();
  });

  it("lasa plata la livrare in pace — acolo neplatit e drumul normal", () => {
    // 14 comenzi cash + unpaid în DB-ul viu. Nu e o anomalie: plătești la ușă.
    for (const method of ["cash", "card_on_delivery"] as const) {
      const p = paymentPresence({ method, status: "unpaid", orderStatus: "accepted" });
      expect(p.notice).toBeNull();
      expect(p.chip).toBeNull();
    }
  });

  it("nu pune nicio bandă pe drumul fericit", () => {
    const online = paymentPresence({ method: "online_gateway", status: "paid", orderStatus: "delivered" });
    const cash = paymentPresence({ method: "cash", status: "paid", orderStatus: "delivered" });
    expect(online.settled).toBe(true);
    expect(online.notice).toBeNull();
    expect(online.chip).toBeNull();
    expect(cash.settled).toBe(true);
    expect(cash.notice).toBeNull();
  });

  it("`settled` e adevărat DOAR pe `paid`", () => {
    const all = ["unpaid", "pending_capture", "paid", "refund_pending", "refunded", "failed"] as const;
    for (const status of all) {
      const p = paymentPresence({ method: "online_gateway", status, orderStatus: "delivered" });
      expect(p.settled).toBe(status === "paid");
    }
  });

  it("nu întoarce niciodată o etichetă goală", () => {
    const methods = ["cash", "card_on_delivery", "online_gateway"] as const;
    const statuses = ["unpaid", "pending_capture", "paid", "refund_pending", "refunded", "failed"] as const;
    for (const method of methods) {
      for (const status of statuses) {
        const p = paymentPresence({ method, status, orderStatus: "delivered" });
        expect(p.totalLabel.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// Garda mecanică — familia lui `courierGold.test.ts` (V5) și `realtimeHonesty`
// (R1). Funcția pură poate fi corectă și tot să nu fie chemată de nimeni; asta a
// fost exact defectul din V11 („starea reală exista deja peste tot; lipsea doar
// să fie citită"). Deci se verifică și call-site-ul.
describe("suprafața clientului chiar citește starea plății", () => {
  const SURFACES = [
    "src/components/customer/OrderTracking.tsx", // cardul de sume + banda
    "src/app/(customer)/orders/page.tsx", // lista de comenzi
  ];

  for (const rel of SURFACES) {
    it(`${rel} trece prin paymentPresence, nu prin eticheta metodei`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("paymentPresence");
      // Eticheta metodei singură e afirmația care mințea: `online_gateway`
      // înseamnă „plătit online" indiferent de `payment_status`.
      expect(src).not.toMatch(/PAYMENT_METHOD_LABEL\[[^\]]*\]/);
    });
  }
});
