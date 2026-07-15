import { createClient } from "@/lib/supabase/server";
import { InviteCourierForm } from "@/components/admin/InviteCourierForm";
import { CourierActiveToggle } from "@/components/admin/CourierActiveToggle";

const VEHICLE_LABEL: Record<string, string> = {
  bike: "Bicicletă",
  e_bike: "E-bike",
  scooter: "Scuter",
  car: "Mașină",
  on_foot: "Pe jos",
};

export default async function PlatformCouriersPage() {
  const supabase = await createClient();
  const { data: couriers } = await supabase.from("couriers").select("*").order("full_name");

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Curieri</h1>

      <InviteCourierForm />

      {couriers?.length === 0 ? (
        <p className="text-white/50">Niciun curier încă.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="py-2">Nume</th>
              <th className="py-2">Telefon</th>
              <th className="py-2">Vehicul</th>
              <th className="py-2">Status</th>
              <th className="py-2">Cont</th>
            </tr>
          </thead>
          <tbody>
            {couriers?.map((courier) => (
              <tr key={courier.id} className="border-b border-white/5">
                <td className="py-2">{courier.full_name}</td>
                <td className="py-2">{courier.phone}</td>
                <td className="py-2">{VEHICLE_LABEL[courier.vehicle_type] ?? courier.vehicle_type}</td>
                <td className="py-2">{courier.status}</td>
                <td className="py-2">
                  <CourierActiveToggle courierId={courier.id} initialActive={courier.is_active} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
