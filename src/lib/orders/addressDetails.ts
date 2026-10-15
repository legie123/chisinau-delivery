// Parity row 3 (Bolt: entrance/floor set before confirming). Same rule as the mobile client
// (mobile/client/src/lib/checkout.ts apartmentDetailsProblem): an apartment without the floor sends
// the courier into the stairwell guessing; a house (no apartment) needs nothing more.
export function apartmentDetailsProblem(d: { apartment?: string | null; floor?: string | null }): string | null {
  if (!d.apartment?.trim()) return null;
  if (!d.floor?.trim()) return "Scrie etajul — curierul trebuie să știe unde urcă (scara și interfonul ajută și ele).";
  return null;
}

/** The addresses row: blank optional fields become NULL (the driver app prints only what is set). */
export function newAddressRow(a: {
  street_address: string; contact_phone: string; sector: string; building: string; apartment: string;
  entrance: string; floor: string; intercom_code: string; notes: string;
}) {
  const opt = (v: string) => v.trim() || null;
  return {
    street_address: a.street_address.trim(),
    contact_phone: a.contact_phone.trim(),
    sector: opt(a.sector),
    building: opt(a.building),
    apartment: opt(a.apartment),
    entrance: opt(a.entrance),
    floor: opt(a.floor),
    intercom_code: opt(a.intercom_code),
    notes: opt(a.notes),
  };
}
