// Cum se citește o durată de livrare pe suprafața de operațiuni (R9).
//
// Motivul e o măsurătoare, nu un gust. „Livrare totală medie" era o medie
// aritmetică pe 7 zile, fără eșantion scris nicăieri, iar pe datele vii de azi
// dădea 2872 min — lângă ținta „≤35–49 min" și lângă verdictul FAIL de pe
// pagina de go/no-go a pilotului. Cele șase livrări reale din fereastră:
//   10130,2 · 7071,7 · 15,1 · 7,2 · 5,4 · 0,0  (minute)
// Patru sub un sfert de oră, două rămase zile în conductă. Mediana e 11,15
// (PASS), media 2871,6 (FAIL): două verdicte opuse de lansare din aceleași
// șase rânduri, după cum alegi măsura centrală.
//
// Regula casei exista deja de două ori și nu ajunsese aici: `get_prep_estimates`
// nu publică o statistică sub 5 observații, iar `20260727001500` a scos
// „turele-scânteie" din mediana KPI-urilor de curier ținând numărul lor VIZIBIL
// (`empty_shifts_14d`) în loc să-l ascundă. Aceleași două reguli, aplicate aici:
// se judecă mediana, se publică eșantionul, iar media rămâne scrisă lângă ea —
// dacă două comenzi chiar au stat zile în conductă, asta e informație
// operațională, nu zgomot de eliminat.

/** Pragul casei: sub atâtea observații nu se publică o statistică, se spune de ce. */
export const MIN_DELIVERY_SAMPLE = 5;

/** Peste atâtea ori mediana, media descrie coada, nu tipicul — și merită spusă. */
const TAIL_RATIO = 1.5;

export type DeliveryDurationInput = {
  medianMinutes: number | null;
  avgMinutes: number | null;
  orders: number | null;
};

export type DeliveryDurationRead = {
  /** Cifra judecată: mediana, rotunjită la minut. „—" când nu se poate. */
  display: string;
  /** Pe ce stă cifra — sau de ce lipsește. Se afișează întotdeauna. */
  sample: string;
  /** Coada lungă, cu numărul ei. `null` când media e de acord cu mediana. */
  tail: string | null;
  /** Fals ⇒ nu se dă niciun verdict pass/fail pe cifra asta. */
  enoughData: boolean;
};

export function formatDeliveryDuration({ medianMinutes, avgMinutes, orders }: DeliveryDurationInput): DeliveryDurationRead {
  const n = orders ?? 0;

  if (n < MIN_DELIVERY_SAMPLE || medianMinutes == null) {
    return {
      display: "—",
      sample:
        n === 0
          ? `nicio livrare în fereastră (prag ${MIN_DELIVERY_SAMPLE})`
          : `${n} ${n === 1 ? "livrare" : "livrări"} · sub pragul de ${MIN_DELIVERY_SAMPLE}`,
      tail: null,
      enoughData: false,
    };
  }

  const median = Math.round(medianMinutes);
  const avg = avgMinutes == null ? null : Math.round(avgMinutes);
  const tail =
    avg != null && medianMinutes > 0 && avg >= medianMinutes * TAIL_RATIO
      ? `media e ${avg} min, trasă de câteva comenzi care au stat mult mai mult`
      : null;

  return {
    display: `${median} min`,
    sample: `${n} ${n === 1 ? "livrare" : "livrări"}`,
    tail,
    enoughData: true,
  };
}
