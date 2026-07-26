import "./premium.css";

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
 * Server component, deliberately light — all motion lives in premium.css
 * (CSS keyframes) and PremiumReveal (WAAPI), both disabled under
 * prefers-reduced-motion. No data fetching, no client JS here.
 */
export default function RestaurantPremiumLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pg-ambient flex flex-1 flex-col">
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
