"use client";

import { useEffect, useState } from "react";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";
import { isVenueType, type VenueType } from "@/lib/concierge/venues";

// Nivelul `focus` din contractul imersiv (§2 al rubricii), legat de momentul pe
// care §5 îl numește explicit pentru concierge: rezervarea confirmată.
//
// Sectorul curier are deja precedentul (`RideAcceptedFocus`) și îi păstrăm
// forma — semnal prin `sessionStorage` + eveniment de fereastră, consumat o
// singură dată — fiindcă aici confirmarea e urmată de `router.refresh()`:
// rândurile listei se re-randează din server, iar un moment ținut în starea
// butonului ar muri odată cu rândul care l-a pornit.
//
// Ce e diferit față de curier, și de ce: momentul poartă LUMEA locului
// (`variant`). Concierge nu are o singură atmosferă — spa, lounge de business,
// sushi și restaurant sunt patru camere diferite din același sector, iar
// confirmarea unei săli de ședințe care se aprinde cu aburi de spa ar fi exact
// eticheta care minte din regula 5. Lumea vine din rândul confirmat, nu din
// filtrul paginii.
const BOOKING_CONFIRMED = "dragons:booking-confirmed";

/** Chemat de `BookingActions` imediat ce serverul a confirmat rezervarea. */
export function markBookingConfirmed(venueType: string | null | undefined) {
  try {
    sessionStorage.setItem(BOOKING_CONFIRMED, venueType ?? "");
    window.dispatchEvent(new Event(BOOKING_CONFIRMED));
  } catch {
    // Fără sessionStorage (mod privat vechi, cotă plină) rămâne evenimentul.
    // Un moment de atmosferă pierdut n-are voie să rupă confirmarea unei
    // rezervări — de-aia toată funcția e best-effort, ca la curier.
  }
}

/** Citește semnalul o singură dată. Exportat ca să-l poată proba un test —
 *  `sessionStorage` are trei feluri de a nu răspunde, iar aici tăcerea lui
 *  trebuie să însemne „fără moment", niciodată „aruncă". */
export function consumeBookingConfirmed(): { variant: VenueType | null } | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(BOOKING_CONFIRMED);
    if (raw === null) return null;
    sessionStorage.removeItem(BOOKING_CONFIRMED);
  } catch {
    return null;
  }
  return { variant: isVenueType(raw) ? raw : null };
}

export function BookingConfirmedFocus() {
  const [world, setWorld] = useState<{ variant: VenueType | null } | null>(null);
  const [said, setSaid] = useState(false);

  useEffect(() => {
    function consume() {
      const signal = consumeBookingConfirmed();
      if (!signal) return;
      setWorld(signal);
      setSaid(true);
    }

    consume(); // confirmarea a pus flagul înainte ca lista să se re-randeze
    window.addEventListener(BOOKING_CONFIRMED, consume); // apăsare în aceeași pagină
    return () => window.removeEventListener(BOOKING_CONFIRMED, consume);
  }, []);

  // Rândul rămâne după ce atmosfera s-a stins: fundalul e o clipire de două
  // secunde, iar o propoziție citită în două secunde e o propoziție ratată.
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(false), 5200);
    return () => window.clearTimeout(t);
  }, [said]);

  return (
    <>
      {world && (
        <SectorBackdrop
          sector="concierge"
          intensity="focus"
          variant={world.variant}
          onDone={() => setWorld(null)}
        />
      )}

      {/* Jumătatea care se CITEȘTE. Atmosfera singură nu e o confirmare: la
          `prefers-reduced-motion`, cu posterul căzut sau pur și simplu pe un
          telefon ținut în soare, momentul de fundal poate să nu ajungă deloc,
          iar singurul semn rămâne o pastilă mică schimbată în listă. Aici stă
          în flux (nu peste conținut, regula 1), împinge lista în jos o dată și
          se retrage, iar `role="status"` îl duce și la cititoarele de ecran —
          altfel confirmarea ar fi fost, literal, doar o culoare. */}
      {said && (
        <p
          role="status"
          className="mb-5 rounded-2xl bg-emerald-400/10 px-4 py-3 text-center text-sm font-semibold text-emerald-200 ring-1 ring-emerald-400/25"
        >
          Rezervare confirmată. Intervalul e al tău.
        </p>
      )}
    </>
  );
}
