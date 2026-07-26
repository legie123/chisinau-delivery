// Central hub — four sectors, no login friction (dev/demo doorway via
// /enter/[role] which signs in the seeded account for that surface). No login
// form anywhere for now (per product decision) — every entry is passwordless.
const SECTORS = [
  {
    href: "/enter/client",
    title: "Clienți",
    subtitle: "Comandă sushi & fine dining",
    emoji: "🍣",
    image: "https://images.unsplash.com/photo-1553621042-f6e147245754?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#3d1220]/95",
  },
  {
    href: "/enter/curier",
    title: "Curieri",
    subtitle: "Livrări & câștiguri",
    emoji: "🛵",
    image: "https://images.unsplash.com/photo-1526367790999-0150786686a2?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#16213e]/95",
  },
  {
    href: "/enter/restaurant",
    title: "Restaurante",
    subtitle: "Meniu, comenzi & catering",
    emoji: "👨‍🍳",
    image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#4a350f]/95",
  },
  {
    href: "/enter/platform",
    title: "Platformă",
    subtitle: "Centru operațional & admin",
    emoji: "🛡️",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#0d0d1f]/95",
  },
];

export default function HubPage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col bg-[#0a0a14] text-white">
      {/* Brand */}
      <div className="flex flex-col items-center gap-1 px-6 pb-6 pt-12 text-center">
        <span className="text-5xl" aria-hidden>🐉</span>
        <h1 className="font-serif text-3xl font-bold tracking-wide text-gold sm:text-4xl">
          DRAGONS DELIVERY
        </h1>
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/45">
          Premium Food Delivery · Chișinău
        </p>
      </div>

      {/* Three sectors */}
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-4 px-5 pb-10 sm:grid-cols-2 lg:grid-cols-4">
        {SECTORS.map((s) => (
          <form key={s.href} method="POST" action={s.href} className="contents">
          <button
            type="submit"
            className="group relative flex min-h-[320px] flex-col justify-end overflow-hidden rounded-3xl text-left ring-1 ring-gold/15 transition duration-300 hover:ring-gold/60 sm:min-h-[480px]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.image}
              alt={s.title}
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
            <div className={`absolute inset-0 bg-gradient-to-b ${s.tint}`} />
            <div className="relative p-6">
              <span className="text-4xl" aria-hidden>{s.emoji}</span>
              <h2 className="mt-2 font-serif text-3xl font-bold text-white transition group-hover:text-gold">
                {s.title}
              </h2>
              <p className="mt-1 text-sm text-white/65">{s.subtitle}</p>
              <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-900 transition group-hover:bg-gold-light">
                Intră
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
                </svg>
              </span>
            </div>
          </button>
          </form>
        ))}
      </div>

      <p className="pb-6 text-center text-xs text-white/30">
        Mod demonstrație — intrare directă, fără parolă
      </p>
    </main>
  );
}
