import "./premium.css";
import { createClient } from "@/lib/supabase/server";
import { chisinauNow, isOpenNow, nextOpeningLabel, type HoursRow } from "@/lib/orders/hours";
import { restaurantPresence, type Presence } from "@/lib/orders/presence";

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
  let presence: Presence | null = null;
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
        // Săptămâna ÎNTREAGĂ de ore, nu doar azi+ieri: `nextOpeningAt` caută
        // printre rândurile primite, iar cu fereastra de azi deja pornită
        // singurul rând rămas ar fi al zilei de ieri, adică peste șase zile
        // (capcana plătită în V7, scrisă ca probă în `hours.test.ts`).
        const [{ data: rest }, { data: hours }] = await Promise.all([
          supabase
            .from("restaurants")
            .select("is_active, accepting_orders")
            .eq("id", restaurantId)
            .maybeSingle(),
          supabase
            .from("restaurant_hours")
            .select("restaurant_id, day_of_week, opens_at, closes_at, is_closed")
            .eq("restaurant_id", restaurantId),
        ]);
        if (rest && rest.is_active === false) showInactiveBanner = true;
        if (rest) {
          const rows = (hours ?? []) as HoursRow[];
          const { dow, time } = chisinauNow();
          presence = restaurantPresence({
            isActive: rest.is_active !== false,
            acceptingOrders: rest.accepting_orders !== false,
            openNow: isOpenNow(rows, dow, time),
            nextOpening: nextOpeningLabel(rows, dow, time),
          });
        }
      }
    }
  } catch {
    showInactiveBanner = false;
    // Sondă moale: dacă starea nu se poate citi, pastila DISPARE. O stare
    // necunoscută nu se rotunjește la „Live" — exact defectul reparat aici.
    presence = null;
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
          {/* Pastila de stare. Scria „Live" ca text fix, lângă un punct care
              pulsa din CSS — nimeni nu măsura nimic: la 07:22, cu Sakura Sushi
              închis (program 00:00–02:00) și cu trei localuri pe
              `accepting_orders=false`, antetul spunea tot „LIVE". Acum vine din
              starea reală, iar punctul care pulsează apare DOAR când localul
              chiar poate primi o comandă. */}
          {presence && (
            <span
              className={`ml-auto flex shrink-0 items-center gap-2 text-[11px] font-medium uppercase tracking-wider ${
                presence.live ? "text-white/55" : "text-amber-200/80"
              }`}
            >
              {presence.live ? (
                <span className="pg-live-dot" aria-hidden />
              ) : (
                <span className="inline-block h-2 w-2 rounded-full bg-amber-400/70" aria-hidden />
              )}
              {presence.label}
              {/* alb/60, nu alb/40: măsurat pe pixeli, /40 dă 3,79:1 pe banda
                  asta — sub pragul de 4,5:1 din §8. Aceeași lecție ca în V5,
                  unde `text-white/40` s-a dovedit 3,8:1 și a urcat la /60. */}
              {presence.detail && (
                <span className="hidden normal-case tracking-normal text-white/60 sm:inline">
                  · {presence.detail}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
