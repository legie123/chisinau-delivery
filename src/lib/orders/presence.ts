// Ce anume e „live" pe suprafața partenerului.
//
// Antetul partenerului scria „Live" ca text fix, lângă un punct care pulsa din
// CSS — o stare pe care nu o măsura nimeni. În aceeași clipă platforma știa
// altceva: `restaurant_open_at()` întorcea `false` pentru Sakura Sushi la 07:22
// (program 00:00–02:00), clientul citea „Închis acum" în listă, iar trei localuri
// din unsprezece au `accepting_orders = false`. Trei suprafețe, un singur adevăr,
// și un singur mincinos.
//
// Aici stă traducerea din starea reală în cuvinte, ca funcție pură — ca să poată
// fi probată fără browser și ca să nu se mai poată strecura un „Live" scris de mână.
// Ordinea contează: se anunță întâi lucrul care BLOCHEAZĂ comenzile cel mai tare.

export type PresenceState = "inactive" | "paused" | "closed" | "open";

export type Presence = {
  state: PresenceState;
  /** Eticheta scurtă — singura care se vede pe telefon. */
  label: string;
  /** Detaliul care încape doar pe ecran lat (când există). */
  detail: string | null;
  /** `true` doar când localul chiar poate primi o comandă acum. */
  live: boolean;
};

export function restaurantPresence(input: {
  isActive: boolean;
  acceptingOrders: boolean;
  openNow: boolean;
  /** Eticheta următoarei deschideri („azi la 11:00"), din `nextOpeningLabel`. */
  nextOpening?: string | null;
}): Presence {
  // 1. Neactivat de platformă — restaurantul nici nu apare la clienți, deci
  //    orice altă stare de sub el e irelevantă. Banda de deasupra explică.
  if (!input.isActive) {
    return { state: "inactive", label: "Neactivat", detail: "nu apare încă la clienți", live: false };
  }
  // 2. Pauza proprie a partenerului (comutatorul din Program). E înaintea
  //    orarului fiindcă e o decizie luată acum, nu una programată.
  if (!input.acceptingOrders) {
    return { state: "paused", label: "Comenzi oprite", detail: "pauză pornită de tine", live: false };
  }
  // 3. În afara programului. `place_order` respinge oricum aici (poarta de ore
  //    din `20260725000400`), deci „Live" ar fi fost o promisiune imposibilă.
  if (!input.openNow) {
    return {
      state: "closed",
      label: "Închis acum",
      detail: input.nextOpening ? `deschide ${input.nextOpening}` : null,
      live: false,
    };
  }
  return { state: "open", label: "Primește comenzi", detail: null, live: true };
}
