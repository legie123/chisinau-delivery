import Link from "next/link";

// Consolidarea panoului de comandă (2026-08-14): rutele canonice rămân pe loc
// (revalidatePath-urile și link-urile existente nu se ating), dar paginile
// înrudite se prezintă ca O secțiune cu tab-uri — nav-ul principal scade la
// 6 intrări. Tab-ul activ e matchuit pe href exact, de către pagina gazdă.
export type SectionTab = { href: string; label: string; badge?: number };

export function SectionTabs({ tabs, current }: { tabs: SectionTab[]; current: string }) {
  return (
    <nav aria-label="Sub-secțiuni" className="mb-6 flex flex-wrap items-center gap-2">
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm ring-1 transition ${
              active
                ? "bg-gold font-semibold text-zinc-900 ring-gold"
                : "text-white/60 ring-white/10 hover:bg-white/5 hover:text-white"
            }`}
          >
            {t.label}
            {t.badge ? (
              <span
                className={`ml-1.5 rounded-full px-1.5 text-[11px] font-bold ${
                  active ? "bg-zinc-900/15 text-zinc-900" : "bg-primary/20 text-primary"
                }`}
              >
                {t.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

// Seturile standard — fiecare pagină gazdă le apelează cu numerele pe care le
// are deja (badge-urile lipsă pur și simplu nu se afișează).
export function ordersTabs(stuckCount?: number): SectionTab[] {
  return [
    { href: "/platform/orders", label: "Toate comenzile" },
    { href: "/platform/queues", label: "Atenție acum", badge: stuckCount },
  ];
}

export function crmTabs(pendingOnboarding?: number): SectionTab[] {
  return [
    { href: "/platform/crm", label: "Clienți" },
    { href: "/platform/restaurants", label: "Restaurante" },
    { href: "/platform/couriers", label: "Curieri" },
    { href: "/platform/onboarding", label: "Onboarding", badge: pendingOnboarding },
  ];
}

export function safetyTabs(openFlags?: number): SectionTab[] {
  return [
    { href: "/platform/fraud", label: "Semnalări", badge: openFlags },
    { href: "/platform/ratings", label: "Reclamații" },
    { href: "/platform/audit", label: "Audit" },
  ];
}
