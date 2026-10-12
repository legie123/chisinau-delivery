// Ce-i trebuie curierului la ușă, pe o linie: "Bloc 12, Scara 2, Etaj 3, Ap. 5, Interfon 45".
// Mirror of mobile/driver/src/lib/orderView.ts addressLines().door (copied, never imported across
// mobile/ <-> src/). "" = no detail, never a placeholder.
export type DoorFields = {
  building?: string | null;
  entrance?: string | null;
  floor?: string | null;
  apartment?: string | null;
  intercom_code?: string | null;
};

export function doorDetails(a: DoorFields): string {
  return [
    a.building && `Bloc ${a.building}`,
    a.entrance && `Scara ${a.entrance}`,
    a.floor && `Etaj ${a.floor}`,
    a.apartment && `Ap. ${a.apartment}`,
    a.intercom_code && `Interfon ${a.intercom_code}`,
  ]
    .filter(Boolean)
    .join(", ");
}
