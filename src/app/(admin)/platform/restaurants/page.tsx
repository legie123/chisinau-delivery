import { createClient } from "@/lib/supabase/server";
import { CreateRestaurantForm } from "@/components/admin/CreateRestaurantForm";
import { InvitePartnerForm } from "@/components/admin/InvitePartnerForm";

export default async function PlatformRestaurantsPage() {
  const supabase = await createClient();
  const { data: restaurants } = await supabase.from("restaurants").select("*").order("name");

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Restaurante</h1>

      <CreateRestaurantForm />

      {restaurants?.length === 0 ? (
        <p className="text-zinc-500">Niciun restaurant încă.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="py-2">Nume</th>
              <th className="py-2">Tip</th>
              <th className="py-2">Sector</th>
              <th className="py-2">Activ</th>
              <th className="py-2">Acceptă comenzi</th>
              <th className="py-2">Partener</th>
            </tr>
          </thead>
          <tbody>
            {restaurants?.map((restaurant) => (
              <tr key={restaurant.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2">{restaurant.name}</td>
                <td className="py-2">{restaurant.cuisine_type}</td>
                <td className="py-2">{restaurant.sector ?? "—"}</td>
                <td className="py-2">{restaurant.is_active ? "Da" : "Nu"}</td>
                <td className="py-2">{restaurant.accepting_orders ? "Da" : "Nu"}</td>
                <td className="py-2">
                  <InvitePartnerForm restaurantId={restaurant.id} restaurantName={restaurant.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
