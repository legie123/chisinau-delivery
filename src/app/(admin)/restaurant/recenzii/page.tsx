import { requireOwnRestaurant } from "@/lib/auth/require";

const fmt = new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeZone: "Europe/Chisinau" });

type Review = { id: string; stars: number; comment: string | null; created_at: string; orders: { order_number: string } | null };

// What customers said about this venue. RLS (ratings_partner_read) limits the read to the
// partner's own restaurant; no customer identity is selected — only the order number.
export default async function RestaurantReviewsPage() {
  const { supabase, restaurantId } = await requireOwnRestaurant();
  const [{ data: breakdown }, { data: rows }] = await Promise.all([
    supabase.rpc("rating_breakdown", { p_restaurant_id: restaurantId }),
    supabase
      .from("ratings")
      .select("id, stars, comment, created_at, orders(order_number)")
      .eq("restaurant_id", restaurantId)
      .eq("target_type", "restaurant")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const buckets = (breakdown ?? []) as { stars: number; rating_count: number; total_ratings: number }[];
  const total = Number(buckets[0]?.total_ratings ?? 0);
  const avg = total ? buckets.reduce((s, b) => s + b.stars * Number(b.rating_count), 0) / total : null;
  const reviews = (rows ?? []) as unknown as Review[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="pg-gold-text mb-2 font-serif text-2xl font-bold">Recenzii</h1>
      {total === 0 ? (
        <p className="pg-card rounded-2xl px-4 py-10 text-center text-sm text-white/55">Nicio recenzie încă.</p>
      ) : (
        <>
          <section className="pg-card mb-6 flex flex-wrap items-center gap-6 rounded-2xl p-5">
            <div>
              <p className="pg-gold-text text-4xl font-bold">{avg!.toFixed(1)}</p>
              <p className="text-xs text-white/50">din {total} recenzii</p>
            </div>
            <ul className="flex min-w-48 flex-1 flex-col gap-1">
              {[...buckets].sort((a, b) => b.stars - a.stars).map((b) => (
                <li key={b.stars} className="flex items-center gap-2 text-xs text-white/60">
                  <span className="w-6">{b.stars}★</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full rounded-full bg-[color:var(--pg-gold-0)]"
                      style={{ width: `${(Number(b.rating_count) / total) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 text-right">{Number(b.rating_count)}</span>
                </li>
              ))}
            </ul>
          </section>
          <ul className="flex flex-col gap-2">
            {reviews.map((r) => (
              <li key={r.id} className="pg-card rounded-2xl px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-amber-300" aria-label={`${r.stars} din 5 stele`}>
                    {"★".repeat(r.stars)}
                    <span className="text-white/20">{"★".repeat(5 - r.stars)}</span>
                  </span>
                  <span className="text-xs text-white/45">
                    {r.orders?.order_number ?? ""} · {fmt.format(new Date(r.created_at))}
                  </span>
                </div>
                {r.comment && <p className="mt-1 text-sm text-white/80">„{r.comment}”</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
