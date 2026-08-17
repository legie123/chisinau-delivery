import { createClient } from "@/lib/supabase/server";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";
import {
  CateringRequestForm,
  type CateringPrefill,
  type CateringRestaurant,
} from "@/components/customer/CateringRequestForm";

// Audit de creștere 2026-08-15: firmele care comandă catering o fac repetat
// (81% din comenzile de birou sunt săptămânale sau mai dese), dar aici totul se
// completa de la zero de fiecare dată — iar butonul „comandă din nou" din
// istoric sare peste catering, fiindcă fluxul lui trece prin ofertă, nu prin coș.
// `?repeta=<id>` reia o comandă livrată: același restaurant, aceleași produse,
// același număr de invitați; clientul schimbă doar data.
export default async function CateringPage({
  searchParams,
}: {
  searchParams: Promise<{ repeta?: string; pentru?: string }>;
}) {
  const { repeta, pentru } = await searchParams;
  const supabase = await createClient();
  // accepting_orders matters too: place_order hard-rejects when it's false,
  // so listing such a restaurant would only produce a failing form.
  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("id, name, catering_min_amount_mdl")
    .eq("is_active", true)
    .eq("accepts_catering", true)
    .eq("accepting_orders", true)
    .order("name");


  // Hub de business: dintr-o rezervare confirmată (sală, ședință) se comandă
  // direct catering pentru acel interval — data, ora și numărul de persoane
  // vin din rezervare, ca nimeni să nu le retasteze. RLS face verificarea:
  // `venue_bookings` e citibil doar de client (sau de locație), deci un id
  // străin nu întoarce nimic.
  let eventPrefill: { date: string; time: string; guests: number; person: string | null; phone: string | null } | null = null;
  if (pentru) {
    const { data: booking } = await supabase
      .from("venue_bookings")
      .select("starts_at, party_size, contact_person, contact_phone, status, restaurants(address)")
      .eq("id", pentru)
      .maybeSingle();

    if (booking && booking.status === "confirmed") {
      const when = new Date(booking.starts_at);
      const local = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Chisinau",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(when);
      const [datePart, timePart] = local.split(" ");
      eventPrefill = {
        date: datePart,
        time: timePart,
        guests: booking.party_size,
        person: booking.contact_person,
        phone: booking.contact_phone,
      };
    }
  }

  // RLS ține reluarea în frâu: `orders` e citibil doar de proprietarul comenzii,
  // deci un id străin pur și simplu nu întoarce nimic — fără verificare separată.
  let prefill: CateringPrefill | null = null;
  if (repeta) {
    const { data: past } = await supabase
      .from("orders")
      .select("restaurant_id, order_items(menu_item_id, quantity), catering_details(guest_count, event_address_text, contact_person, contact_phone)")
      .eq("id", repeta)
      .eq("order_type", "catering")
      .maybeSingle();

    const details = (past as { catering_details?: { guest_count: number; event_address_text: string; contact_person: string; contact_phone: string } | null } | null)
      ?.catering_details;
    if (past?.restaurant_id) {
      prefill = {
        restaurantId: past.restaurant_id,
        quantities: Object.fromEntries(
          ((past.order_items ?? []) as { menu_item_id: string | null; quantity: number }[])
            .filter((i) => i.menu_item_id)
            .map((i) => [i.menu_item_id as string, i.quantity]),
        ),
        guestCount: details?.guest_count ?? null,
        eventAddress: details?.event_address_text ?? null,
        contactPerson: details?.contact_person ?? null,
        contactPhone: details?.contact_phone ?? null,
      };
    }
  }

  return (
    <main className="relative isolate flex-1 px-6 py-10">
      {/* `hero` MĂRGINIT: formularul începe la mai puțin de un ecran, iar
          regula casei interzice film sub liste — atmosfera umple doar antetul. */}
      <SectorBackdrop sector="concierge" intensity="hero" bounded />
      <h1 className="mb-1 text-2xl font-semibold">Catering pentru evenimente</h1>
      <p className="mb-8 max-w-xl text-sm text-white/50">
        Platouri și meniuri pentru evenimente, livrate de restaurantele partenere. Trimiți cererea,
        primești oferta, confirmi — noi livrăm.
      </p>
      <CateringRequestForm
        restaurants={(restaurants ?? []) as CateringRestaurant[]}
        prefill={prefill}
        eventPrefill={eventPrefill}
      />
    </main>
  );
}
