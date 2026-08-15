import { createClient } from "@/lib/supabase/server";
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
  searchParams: Promise<{ repeta?: string }>;
}) {
  const { repeta } = await searchParams;
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
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Catering pentru evenimente</h1>
      <p className="mb-8 max-w-xl text-sm text-white/50">
        Platouri și meniuri pentru evenimente, livrate de restaurantele partenere. Trimiți cererea,
        primești oferta, confirmi — noi livrăm.
      </p>
      <CateringRequestForm
        restaurants={(restaurants ?? []) as CateringRestaurant[]}
        prefill={prefill}
      />
    </main>
  );
}
