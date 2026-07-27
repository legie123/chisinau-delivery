import "@/app/(admin)/restaurant/premium.css";

/**
 * Scoped premium-CSS import for the customer restaurant browse + detail
 * surfaces (/restaurants, /restaurants/[slug]) — no wrapper markup, no
 * `pg-ambient` background swap (that stays a partner-surface treatment).
 * This layout exists purely so `pg-card` / `pg-hairline-divider` /
 * `pg-hero-facet` / `pg-shimmer` / `pg-gold-text` / <PremiumReveal> can be
 * used on these two customer pages without duplicating premium.css — the
 * design DNA calls the premium register "the aspirational target ... pulled
 * toward platform-wide", and this is the first customer-facing pull.
 */
export default function RestaurantsPremiumLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
