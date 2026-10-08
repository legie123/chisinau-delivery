"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCartStore } from "@/lib/orders/cart";
import { useHydrated } from "@/hooks/useHydrated";

// Bara de jos a aplicației de client (stil Glovo/Wolt) — doar pe telefon (`sm:hidden`).
// Pe ecran mic înlocuiește navigarea din antet: acolo linkurile aveau 20px înălțime,
// sub minimul de atingere, iar o bară de jos e singurul loc unde 5 ținte de 64px
// încap fără să se suprapună. Înălțimea ei e `--tabbar-h` (setat în layout-ul
// clientului); orice element `fixed` de jos al clientului stă deasupra ei prin acel var.

type Tab = { href: string; label: string; match: string[]; icon: React.ReactNode };

const icon = (d: string) => (
  <svg aria-hidden className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const TABS: Tab[] = [
  {
    href: "/restaurants",
    label: "Restaurante",
    match: ["/restaurants"],
    icon: icon("M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z"),
  },
  {
    href: "/catering",
    label: "Catering",
    match: ["/catering"],
    icon: icon("M4 15h16M5 15a7 7 0 0 1 14 0M12 8V6M3 18h18"),
  },
  {
    href: "/concierge",
    label: "Concierge",
    match: ["/concierge"],
    icon: icon("M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-3 3v11m0-4h3m-3-3h2"),
  },
  {
    href: "/cart",
    label: "Coș",
    match: ["/cart", "/checkout"],
    icon: icon("M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20.5h.01M17 20.5h.01"),
  },
  {
    href: "/orders",
    label: "Comenzi",
    match: ["/orders"],
    icon: icon("M8 4h8a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Zm1 5h6m-6 4h4"),
  },
];

export function AppTabBar({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const lines = useCartStore((s) => s.lines);
  const hydrated = useHydrated();
  const count = hydrated ? lines.reduce((sum, l) => sum + l.quantity, 0) : 0;

  return (
    <nav
      aria-label="Navigare principală"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0a0a14]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {TABS.map((tab) => {
          const active = tab.match.some((p) => pathname === p || pathname.startsWith(`${p}/`));
          const href = tab.href === "/orders" && !signedIn ? "/login?next=/orders" : tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium [-webkit-tap-highlight-color:transparent] active:scale-95 motion-reduce:active:scale-100 ${
                  active ? "text-gold" : "text-white/55"
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.href === "/cart" && count > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary-dark px-1 text-[10px] font-bold text-white">
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
