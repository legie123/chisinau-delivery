import "./premium.css";
import { createClient } from "@/lib/supabase/server";

/**
 * Premium restaurant SHELL — Dragons Alliance design layer.
 *
 * Nests INSIDE the shared (admin) layout: that parent already renders the
 * brand + the horizontally-scrolling nav + sign-out. This layout adds ZERO
 * navigation — it only wraps the restaurant surfaces in the ambient premium
 * background (dragon-scale weave + gold/amethyst rim-light) and a slim
 * "DRAGONS" crest strip so the partner sector reads as a jewelled command
 * centre, not a plain dashboard.
 *
 * Plus a soft account-status probe: a freshly-approved restaurant lands with
 * is_active=false (platform activates it), so a partner could configure
 * everything and still see zero orders with no explanation. The banner makes
 * that state legible. The probe never throws (admins / unlinked users see
 * nothing) so it can't break the shell.
 *
 * Server component, deliberately light — all motion lives in premium.css
 * (CSS keyframes) and PremiumReveal (WAAPI), both disabled under
 * prefers-reduced-motion.
 */
export default async function RestaurantPremiumLayout({ children }: { children: React.ReactNode }) {
  let showInactiveBanner = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: staffRows } = await supabase
        .from("restaurant_staff")
        .select("restaurant_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1);
      const restaurantId = staffRows?.[0]?.restaurant_id as string | undefined;
      if (restaurantId) {
        const { data: rest } = await supabase
          .from("restaurants")
          .select("is_active")
          .eq("id", restaurantId)
          .maybeSingle();
        if (rest && rest.is_active === false) showInactiveBanner = true;
      }
    }
  } catch {
    showInactiveBanner = false;
  }

  return (
    <div className="pg-ambient flex flex-1 flex-col">
      {showInactiveBanner && (
        <div
          role="status"
          className="border-b border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-center text-sm text-amber-100 sm:px-6"
        >
          <span className="font-semibold">Cont în așteptare de activare.</span>{" "}
          Poți configura meniul, orele și setările, dar restaurantul nu apare încă
          pentru clienți și nu primește comenzi până când un administrator îl activează.
        </div>
      )}
      {/* Slim crest strip — a wordmark accent, NOT a nav bar. */}
      <div className="pg-crest px-4 py-2 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <span className="pg-crest-mark text-sm font-semibold uppercase">
            <span className="pg-gold-text pg-gold-text--live">Dragons</span>
            <span className="ml-2 text-white/35">Partener Restaurant</span>
          </span>
          <span className="ml-auto flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/40">
            <span className="pg-live-dot" aria-hidden />
            Live
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}
