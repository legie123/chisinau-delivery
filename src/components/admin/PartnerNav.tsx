import Link from "next/link";

// Partner (restaurant) nav — the same links, order and classes as the partner branch
// of src/app/(admin)/layout.tsx. Used by the restaurant app shell (apps/restaurant);
// the monolith keeps its own role-split header and does not import this.
// Comenzi first: it's the SLA-driven page (7-minute auto-cancel on new orders).
const LINKS: Array<[href: string, label: string, hover: string]> = [
  ["/restaurant/orders", "Comenzi", "hover:text-white"],
  ["/restaurant/rezervari", "Rezervări", "hover:text-white"],
  ["/restaurant/menu", "Meniul meu", "hover:text-white"],
  ["/restaurant/hours", "Program", "hover:text-white"],
  ["/restaurant/catering", "Catering", "hover:text-white"],
  ["/restaurant/earnings", "Câștiguri", "hover:text-gold"],
  ["/restaurant/analytics", "Analiză", "hover:text-gold"],
  ["/restaurant/recenzii", "Recenzii", "hover:text-gold"],
];

export function PartnerNav() {
  return (
    <nav className="no-scrollbar flex min-w-0 flex-1 gap-4 overflow-x-auto text-sm text-white/70">
      {LINKS.map(([href, label, hover]) => (
        <Link key={href} href={href} className={`shrink-0 whitespace-nowrap transition ${hover}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
