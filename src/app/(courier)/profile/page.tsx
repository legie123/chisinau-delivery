import { supportPhone } from "@chisinau/shared-domain";
import { createClient } from "@/lib/supabase/server";
import { CourierPayoutForm } from "@/components/courier/CourierPayoutForm";

// Same key map as (admin)/platform/couriers; the courier only reads it.
const VEHICLE_LABEL: Record<string, string> = {
  bike: "Bicicletă",
  e_bike: "E-bike",
  scooter: "Scuter",
  car: "Mașină",
  on_foot: "Pe jos",
};

// Same source as the customer layout and the driver app: NEXT_PUBLIC_SUPPORT_PHONE, null until a
// real number is configured — then the line is simply absent, never a placeholder.
const SUPPORT_PHONE = supportPhone(process.env.NEXT_PUBLIC_SUPPORT_PHONE);

export default async function CourierProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courier } = await supabase
    .from("couriers")
    .select("id, full_name, phone, vehicle_type")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  if (!courier) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16 text-center">
        <p className="text-white/60">Contul tău nu este înregistrat ca curier.</p>
      </main>
    );
  }

  // RLS: the courier reads only their own row (payout_accounts_read, 000402).
  const { data: account } = await supabase
    .from("payout_accounts")
    .select("iban, holder_name")
    .eq("recipient_type", "courier")
    .eq("recipient_id", courier.id)
    .maybeSingle();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="font-serif text-2xl font-bold text-white">Profil</h1>
      <p className="mb-6 mt-1 text-sm text-white/50">Datele tale de curier și contul pentru plata săptămânală.</p>

      <section className="mb-6 grid grid-cols-1 gap-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06] sm:grid-cols-3">
        <div>
          <p className="text-xs text-white/40">Nume</p>
          <p className="mt-0.5 font-medium text-white">{courier.full_name}</p>
        </div>
        <div>
          <p className="text-xs text-white/40">Telefon</p>
          <p className="mt-0.5 font-medium text-white">{courier.phone}</p>
        </div>
        <div>
          <p className="text-xs text-white/40">Vehicul</p>
          <p className="mt-0.5 font-medium text-white">{VEHICLE_LABEL[courier.vehicle_type] ?? courier.vehicle_type}</p>
        </div>
      </section>

      <CourierPayoutForm current={account} defaultHolder={courier.full_name} />

      {SUPPORT_PHONE && (
        <p className="mt-6 text-sm text-white/50">
          Ajutor &amp; suport:{" "}
          <a href={SUPPORT_PHONE.tel} className="text-white transition hover:text-gold">
            {SUPPORT_PHONE.label}
          </a>
        </p>
      )}
    </main>
  );
}
