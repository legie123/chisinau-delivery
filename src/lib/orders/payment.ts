// Ce anume s-a întâmplat cu banii clientului.
//
// Cardul de sume din `OrderTracking` scria `Total ({PAYMENT_METHOD_LABEL[...]})`,
// iar eticheta metodei `online_gateway` e „plătit online" — un verb la trecut.
// Adică o AFIRMAȚIE despre plată, scrisă fără ca cineva să citească vreodată
// `payment_status`. În DB-ul viu la 2026-08-16, șase din nouă comenzi online o
// contraziceau: una cu plata EȘUATĂ, una cu banii doar rezervați pe card, două
// returnate (1.475 MDL la un loc) și două neplătite. Cea mai scumpă:
// CHD-2026-000011, livrată și returnată, unde ecranul arăta „Livrată cu succes"
// și „Total (plătit online) 1000 MDL" — 1000 de lei se întorseseră la client și
// aplicația nu spunea nicăieri.
//
// Datele erau deja acolo (`select("*")` pe pagina comenzii, iar `useOrderRealtime`
// aduce rândul întreg la fiecare schimbare). Lipsea doar să fie citite — exact
// tiparul găsit de V11 pe suprafața partenerului.
//
// Aici stă traducerea din starea reală în cuvinte, ca funcție pură, în aceeași
// familie cu `restaurantPresence` (`presence.ts`): probabilă fără browser, și
// imposibil de ocolit cu o etichetă scrisă de mână.

import type { OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/types/domain";

/** `good` = ceva s-a rezolvat în favoarea clientului; `warning` = banii lui stau undeva. */
export type PaymentTone = "good" | "warning";

export type PaymentNotice = {
  label: string;
  detail: string | null;
  tone: PaymentTone;
};

export type PaymentPresence = {
  /** Textul din paranteza de lângă „Total". Descrie starea, nu intenția. */
  totalLabel: string;
  /** `true` DOAR când banii au ajuns cu adevărat la platformă. */
  settled: boolean;
  /** Rândul explicit din cardul de sume. `null` = nu e nimic de spus. */
  notice: PaymentNotice | null;
  /** Pastila scurtă din lista de comenzi. `null` = rândul nu trebuie să strige. */
  chip: string | null;
};

const METHOD_BASE: Record<PaymentMethod, string> = {
  cash: "cash",
  card_on_delivery: "card la livrare",
  online_gateway: "online",
};

/** Comanda s-a terminat prost — nu mai vine nimic, deci întrebarea devine „am fost taxat?". */
function isTerminal(status: OrderStatus): boolean {
  return status === "cancelled" || status === "rejected";
}

export function paymentPresence(input: {
  method: PaymentMethod;
  status: PaymentStatus;
  orderStatus: OrderStatus;
  /** Suma, ca s-o poată scrie banda de returnare. Lipsa ei nu ascunde returnarea. */
  amountMdl?: number | string | null;
}): PaymentPresence {
  const base = METHOD_BASE[input.method];
  const amount =
    input.amountMdl == null || input.amountMdl === "" ? null : `${input.amountMdl} MDL`;

  // 1. Banii s-au întors. E adevărat pe ORICE metodă — o comandă cash returnată
  //    scrie o mișcare negativă în `courier_cash_movements` (`refund_reversal`,
  //    migrația 20260806000400) — deci nu se filtrează pe `online_gateway`.
  if (input.status === "refunded") {
    return {
      totalLabel: `${base}, bani returnați`,
      settled: false,
      notice: {
        label: "Banii ți-au fost returnați",
        detail: amount,
        tone: "good",
      },
      chip: "Bani returnați",
    };
  }
  if (input.status === "refund_pending") {
    return {
      totalLabel: `${base}, returnare în curs`,
      settled: false,
      notice: {
        label: "Returnare în curs",
        detail: amount ? `${amount} — ajung înapoi în câteva zile lucrătoare` : "banii ajung înapoi în câteva zile lucrătoare",
        tone: "warning",
      },
      chip: "Returnare în curs",
    };
  }

  // 2. Plata la ușă: `unpaid` e drumul NORMAL, nu o anomalie (14 comenzi cash
  //    unpaid în DB-ul viu). O bandă aici ar fi zgomot, adică exact ce face ca
  //    benzile adevărate să nu mai fie citite.
  if (input.method !== "online_gateway") {
    return { totalLabel: base, settled: input.status === "paid", notice: null, chip: null };
  }

  // 3. Plata online, pe stările în care ea NU s-a făcut.
  if (input.status === "paid") {
    return { totalLabel: "plătit online", settled: true, notice: null, chip: null };
  }
  if (input.status === "failed") {
    return {
      totalLabel: "online, plată eșuată",
      settled: false,
      notice: {
        label: "Plata online nu a trecut",
        detail: isTerminal(input.orderStatus)
          ? "nu ți s-a luat niciun ban"
          : "nu ți s-a luat niciun ban — comanda nu poate porni până nu reiei plata",
        tone: "warning",
      },
      chip: "Plată eșuată",
    };
  }
  if (input.status === "pending_capture") {
    return {
      totalLabel: "online, rezervat pe card",
      settled: false,
      notice: {
        label: "Suma e doar rezervată pe card",
        detail: amount ? `${amount} blocați, încă neîncasați` : "blocată, încă neîncasată",
        tone: "warning",
      },
      chip: "Plată rezervată",
    };
  }

  // `unpaid` pe o comandă terminată: nimeni nu i-a luat nimic. Tăcerea de aici
  // costă invers — omul se întreabă dacă a fost taxat pentru ceva ce n-a primit.
  if (isTerminal(input.orderStatus)) {
    return {
      totalLabel: "online, neplătit",
      settled: false,
      notice: { label: "Nu ai fost taxat", detail: "plata online nu a pornit", tone: "good" },
      chip: null,
    };
  }

  // `unpaid` pe o comandă VIE. Nu e un detaliu contabil: `advance_delivery_status`
  // refuză livrarea unei comenzi online neplătite (migrația 20260725000100), deci
  // asta e chiar motivul pentru care mâncarea nu va veni niciodată.
  return {
    totalLabel: "online, neplătit",
    settled: false,
    notice: {
      label: "Plata online nu s-a finalizat",
      detail: "comanda nu poate fi livrată până nu trece plata",
      tone: "warning",
    },
    chip: "Plată neefectuată",
  };
}
