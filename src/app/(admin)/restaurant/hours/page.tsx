import { createClient } from "@/lib/supabase/server";
import { HoursForm } from "@/components/admin/HoursForm";
import { AcceptingOrdersToggle } from "@/components/admin/AcceptingOrdersToggle";
import { PremiumReveal } from "@/components/admin/premium/PremiumReveal";
import type { RestaurantHours } from "@/lib/types/domain";

export default async function RestaurantHoursPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Multi-restaurant partner guard: .maybeSingle() throws on 2+ rows — take the
  // primary (oldest) link so the page never 500s.
  const { data: staffRows } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id")
    .eq("user_id", user?.id ?? "")
    .order("created_at", { ascending: true })
    .limit(1);
  const staffRow = staffRows?.[0] ?? null;

  if (!staffRow) {
    return (
      <main className="flex-1 px-6 py-10">
        <h1 className="mb-2 text-2xl font-semibold">Program</h1>
        <p className="text-white/50">
          Contul tău nu este încă asociat cu un restaurant. Contactează un administrator.
        </p>
      </main>
    );
  }

  const restaurantId = staffRow.restaurant_id as string;

  const [{ data: restaurant }, { data: hours }] = await Promise.all([
    supabase.from("restaurants").select("accepting_orders").eq("id", restaurantId).single(),
    supabase.from("restaurant_hours").select("*").eq("restaurant_id", restaurantId),
  ]);

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 font-serif text-2xl font-semibold pg-gold-text">Program</h1>
      <PremiumReveal as="div" className="pg-card mb-6 rounded-2xl p-4">
        <AcceptingOrdersToggle initialValue={restaurant?.accepting_orders ?? true} />
      </PremiumReveal>
      <PremiumReveal as="div" delay={60} className="pg-card rounded-2xl p-4">
        <HoursForm hours={(hours ?? []) as RestaurantHours[]} />
      </PremiumReveal>
    </main>
  );
}
