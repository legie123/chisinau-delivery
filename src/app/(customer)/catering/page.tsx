import { createClient } from "@/lib/supabase/server";
import { CateringRequestForm, type CateringRestaurant } from "@/components/customer/CateringRequestForm";

export default async function CateringPage() {
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

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Catering pentru evenimente</h1>
      <p className="mb-8 max-w-xl text-sm text-white/50">
        Platouri și meniuri pentru evenimente, livrate de restaurantele partenere. Trimiți cererea,
        primești oferta, confirmi — noi livrăm.
      </p>
      <CateringRequestForm restaurants={(restaurants ?? []) as CateringRestaurant[]} />
    </main>
  );
}
