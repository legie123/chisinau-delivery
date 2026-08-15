// Vocabularul rețelei concierge, într-un singur loc: etichete în română,
// verbul potrivit fiecărui tip de locație și scopul implicit al rezervării.
// „restaurant" și „sushi_bar" livrează mâncare (comportamentul dinainte);
// celelalte trei se rezervă — clientul merge acolo.
export type VenueType = "restaurant" | "sushi_bar" | "spa" | "wellness_lounge" | "business_lounge";
export type BookingPurpose = "meeting" | "dining" | "wellness" | "event";

export const VENUE_META: Record<
  VenueType,
  { label: string; plural: string; blurb: string; purpose: BookingPurpose; bookable: boolean; orderable: boolean }
> = {
  business_lounge: {
    label: "Sală de business",
    plural: "Săli de business",
    blurb: "Ședințe, brainstorming, prezentări — cu catering la cerere.",
    purpose: "meeting",
    bookable: true,
    orderable: false,
  },
  spa: {
    label: "Spa",
    plural: "Spa-uri",
    blurb: "Ritualuri de relaxare și recuperare, rezervate pe interval.",
    purpose: "wellness",
    bookable: true,
    orderable: false,
  },
  wellness_lounge: {
    label: "Lounge wellness",
    plural: "Lounge-uri wellness",
    blurb: "Pauza care repune echipa pe picioare.",
    purpose: "wellness",
    bookable: true,
    orderable: false,
  },
  sushi_bar: {
    label: "Sushi bar",
    plural: "Sushi",
    blurb: "Livrare acasă sau masă rezervată la bar.",
    purpose: "dining",
    bookable: true,
    orderable: true,
  },
  restaurant: {
    label: "Restaurant",
    plural: "Restaurante",
    blurb: "Fine dining livrat sau servit la fața locului.",
    purpose: "dining",
    bookable: true,
    orderable: true,
  },
};

/** Ordinea în care apar sectoarele pe pagina de concierge — business-ul primul,
 *  fiindcă acolo e miezul poveștii: hub de întâlniri, nu doar mâncare. */
export const VENUE_ORDER: VenueType[] = [
  "business_lounge",
  "restaurant",
  "sushi_bar",
  "spa",
  "wellness_lounge",
];

export function isVenueType(value: string): value is VenueType {
  return value in VENUE_META;
}

export const PURPOSE_LABEL: Record<BookingPurpose, string> = {
  meeting: "Ședință / brainstorming",
  dining: "Masă",
  wellness: "Wellness",
  event: "Eveniment",
};

export const BOOKING_STATUS_LABEL: Record<string, string> = {
  requested: "Cerere trimisă",
  quoted: "Ofertă primită",
  confirmed: "Confirmată",
  declined: "Refuzată",
  cancelled: "Anulată",
  completed: "Încheiată",
};
