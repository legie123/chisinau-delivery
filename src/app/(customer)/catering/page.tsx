import { createClient } from "@/lib/supabase/server";
import { CateringRequestForm } from "@/components/customer/CateringRequestForm";
import type { Restaurant } from "@/lib/types/domain";

export default async function CateringPage() {
  const supabase = await createClient();
  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("*")
    .eq("is_active", true)
    .eq("accepts_catering", true)
    .order("name");

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Catering pentru evenimente</h1>
      <p className="mb-8 max-w-xl text-sm text-zinc-500">
        Platouri și meniuri pentru evenimente, livrate de restaurantele partenere. Trimiți cererea,
        primești oferta, confirmi — noi livrăm.
      </p>
      <CateringRequestForm restaurants={(restaurants ?? []) as Restaurant[]} />
    </main>
  );
}
