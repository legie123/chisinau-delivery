import Link from "next/link";
import { requireOwnRestaurant } from "@/lib/auth/require";
import { MenuStockRow } from "@/components/admin/MenuStockRow";

const timeFmt = new Intl.DateTimeFormat("ro-RO", { timeStyle: "short", timeZone: "Europe/Chisinau" });

function soldOutLabel(until: string | null, nowMs: number): string | null {
  if (!until) return null;
  if (until === "infinity") return "Epuizat până îl reactivezi";
  const t = new Date(until).getTime();
  return t > nowMs ? `Epuizat până la ${timeFmt.format(t)}` : null;
}

function nowMs() {
  return Date.now();
}

// Quick stock screen for the tablet: one tap marks a dish sold out without hiding
// it (sold_out_until, not is_available). Hidden/archived items are not listed.
export default async function RestaurantStockPage() {
  const { supabase, restaurantId } = await requireOwnRestaurant();
  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase.from("menu_categories").select("id, name").eq("restaurant_id", restaurantId).order("sort_order"),
    supabase
      .from("menu_items")
      .select("id, name, category_id, sold_out_until")
      .eq("restaurant_id", restaurantId)
      .eq("is_available", true)
      .order("sort_order"),
  ]);
  const now = nowMs();
  const rows = (items ?? []).map((i) => ({ ...i, label: soldOutLabel(i.sold_out_until, now) }));
  const soldOut = rows.filter((r) => r.label).length;
  const groups = [...(categories ?? []), { id: null, name: "Fără categorie" }]
    .map((c) => ({ ...c, items: rows.filter((r) => r.category_id === c.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <div className="mb-1">
        <Link href="/restaurant/orders" className="text-xs text-white/50 transition hover:text-gold hover:underline">
          ← Înapoi la comenzi
        </Link>
      </div>
      <h1 className="pg-gold-text mb-2 font-serif text-2xl font-bold">Stoc</h1>
      <p className="mb-6 text-sm text-white/55">
        {soldOut === 0
          ? "Toate produsele sunt disponibile."
          : soldOut === 1
            ? "Un produs epuizat."
            : `${soldOut} produse epuizate.`} Un produs epuizat rămâne
        vizibil în meniu, dar nu mai poate fi comandat. „Epuizat azi” se anulează singur la miezul nopții.
      </p>
      {groups.map((g) => (
        <section key={g.id ?? "none"} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">{g.name}</h2>
          <ul className="flex flex-col gap-2">
            {g.items.map((i) => (
              <MenuStockRow key={i.id} id={i.id} name={i.name} soldOutLabel={i.label} />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
