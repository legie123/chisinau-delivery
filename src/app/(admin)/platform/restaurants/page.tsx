import { createClient } from "@/lib/supabase/server";
import { SectionTabs, crmTabs } from "@/components/admin/SectionTabs";
import { CreateRestaurantForm } from "@/components/admin/CreateRestaurantForm";
import { InvitePartnerForm } from "@/components/admin/InvitePartnerForm";
import { RestaurantActiveToggle } from "@/components/admin/RestaurantActiveToggle";
import { RestaurantLocationControl } from "@/components/admin/RestaurantLocationControl";
import type { AdminRestaurantKpiRow } from "@/lib/types/domain";

export default async function PlatformRestaurantsPage() {
  const supabase = await createClient();
  const [{ data: restaurants }, { data: kpis }] = await Promise.all([
    supabase.from("restaurants").select("*").order("name"),
    // WS7 — rolling 7-day acceptance KPIs (server-side only, never polled live).
    supabase.from("admin_restaurant_kpis").select("*"),
  ]);
  const kpiById = new Map<string, AdminRestaurantKpiRow>(
    ((kpis ?? []) as AdminRestaurantKpiRow[]).map((k) => [k.id, k]),
  );

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">CRM</h1>
      <p className="mb-4 text-sm text-white/50">Restaurante</p>
      <SectionTabs tabs={crmTabs()} current="/platform/restaurants" />

      <CreateRestaurantForm />

      {restaurants?.length === 0 ? (
        <p className="text-white/50">Niciun restaurant încă.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="py-2">Nume</th>
              <th className="py-2">Tip</th>
              <th className="py-2">Sector</th>
              <th className="py-2">Locație</th>
              <th className="py-2">Activ</th>
              <th className="py-2">Acceptă</th>
              <th className="py-2">Rată accept. 7z</th>
              <th className="py-2">Timp mediu</th>
              <th className="py-2">Anulate auto 7z</th>
              <th className="py-2">Partener</th>
            </tr>
          </thead>
          <tbody>
            {restaurants?.map((restaurant) => {
              const kpi = kpiById.get(restaurant.id);
              return (
              <tr key={restaurant.id} className="border-b border-white/5">
                <td className="py-2">{restaurant.name}</td>
                <td className="py-2">{restaurant.cuisine_type}</td>
                <td className="py-2">{restaurant.sector ?? "—"}</td>
                <td className="py-2">
                  <RestaurantLocationControl restaurantId={restaurant.id} lat={restaurant.lat} lng={restaurant.lng} />
                </td>
                <td className="py-2">
                  <RestaurantActiveToggle restaurantId={restaurant.id} initialActive={restaurant.is_active} />
                </td>
                <td className="py-2">{restaurant.accepting_orders ? "Da" : "Nu"}</td>
                <td className="py-2">
                  {kpi?.acceptance_rate_7d != null ? `${Math.round(kpi.acceptance_rate_7d * 100)}%` : "—"}
                </td>
                <td className="py-2">
                  {kpi?.avg_accept_minutes_7d != null ? `${kpi.avg_accept_minutes_7d} min` : "—"}
                </td>
                <td className="py-2">
                  {kpi && kpi.auto_cancelled_7d > 0 ? (
                    <span className="text-primary">{kpi.auto_cancelled_7d}</span>
                  ) : (
                    kpi?.auto_cancelled_7d ?? "—"
                  )}
                </td>
                <td className="py-2">
                  <InvitePartnerForm restaurantId={restaurant.id} restaurantName={restaurant.name} />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
