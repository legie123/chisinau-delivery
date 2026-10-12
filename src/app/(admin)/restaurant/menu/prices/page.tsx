import Link from "next/link";
import { requireOwnRestaurant } from "@/lib/auth/require";
import { MenuBulkPriceForm } from "@/components/admin/MenuBulkPriceForm";

export default async function MenuBulkPricePage() {
  const { supabase, restaurantId } = await requireOwnRestaurant();
  const { data } = await supabase.from("menu_categories").select("id, name").eq("restaurant_id", restaurantId).order("sort_order");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <div className="mb-1">
        <Link href="/restaurant/menu" className="text-xs text-white/50 transition hover:text-gold hover:underline">
          ← Înapoi la meniu
        </Link>
      </div>
      <h1 className="pg-gold-text mb-2 font-serif text-2xl font-bold">Prețuri în masă</h1>
      <p className="mb-5 text-sm text-white/60">
        Schimbă toate prețurile dintr-o categorie (sau din tot meniul) cu un procent sau o sumă. Vezi lista întâi, apoi aplici.
        Comenzile deja plasate își păstrează prețul. Prețurile se rotunjesc la lei întregi.
      </p>
      <MenuBulkPriceForm categories={(data ?? []) as { id: string; name: string }[]} />
    </main>
  );
}
