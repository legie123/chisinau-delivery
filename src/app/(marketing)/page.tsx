import Link from "next/link";
import { AmbientVideo } from "@/components/marketing/AmbientVideo";
import { masterDoorwayEnabled } from "@/lib/master/gate";

// Central hub — patru porți (fiecare sector își începe experiența pe
// pagina LUI de start) + intrarea de cont. Intrarea demonstrativă fără parolă
// trăiește EXCLUSIV în spatele /master (poarta cu parolă a proprietarului) —
// hub-ul public nu mai oferă nicio ușă passwordless (2026-08-14).
const DOORS = [
  {
    href: "/start/client",
    title: "Clienți",
    subtitle: "Comandă sushi & fine dining",
    emoji: "🍣",
    image: "https://images.unsplash.com/photo-1553621042-f6e147245754?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#3d1220]/95",
  },
  {
    href: "/concierge",
    title: "Concierge",
    subtitle: "Spa, wellness & săli de business",
    emoji: "🗝️",
    image: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#1a2f3d]/95",
  },
  {
    href: "/start/curier",
    title: "Curieri",
    subtitle: "Livrări & câștiguri",
    emoji: "🛵",
    image: "https://images.unsplash.com/photo-1526367790999-0150786686a2?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#16213e]/95",
  },
  {
    href: "/start/restaurant",
    title: "Restaurante",
    subtitle: "Meniu, comenzi & catering",
    emoji: "👨‍🍳",
    image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#4a350f]/95",
  },
];

export default function HubPage() {
  // `isolate` e obligatoriu: fără stacking context propriu, copilul cu -z-10
  // (AmbientVideo) cade sub fundalul opac al lui <main> și video-ul devine
  // invizibil deși rulează (bug-ul „este identic" raportat de user).
  return (
    <main className="relative isolate flex min-h-screen flex-1 flex-col bg-[#0a0a14] text-white">
      {/* Ambient cinematic backdrop (audit design: primul contact = premium) */}
      <AmbientVideo src="/videos/hero-sushi.mp4" poster="/videos/hero-sushi-poster.jpg" />
      {/* Brand */}
      <div className="flex flex-col items-center gap-1 px-6 pb-6 pt-12 text-center">
        <span className="text-5xl" aria-hidden>🐉</span>
        <h1 className="font-serif text-3xl font-bold tracking-wide text-gold sm:text-4xl">
          DRAGONS DELIVERY
        </h1>
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/45">
          Concierge premium · Chișinău
        </p>
      </div>

      {/* Porțile pe rol */}
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-4 px-5 pb-10 sm:grid-cols-2 lg:grid-cols-4">
        {DOORS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group relative flex min-h-[320px] flex-col justify-end overflow-hidden rounded-3xl text-left ring-1 ring-gold/15 transition duration-300 hover:ring-gold/60 sm:min-h-[460px]"
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
                Începe aici
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
                </svg>
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* Cont real */}
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-5 pb-8">
        <div className="flex items-center gap-3 text-white/30">
          <span className="h-px w-16 bg-white/10" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.3em]">Cont</span>
          <span className="h-px w-16 bg-white/10" />
        </div>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-full border border-gold/40 px-6 py-3 text-sm font-semibold text-gold transition hover:border-gold/70 hover:bg-gold/5"
        >
          Intră în cont sau înregistrează-te
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
          </svg>
        </Link>
        {/* Poarta proprietarului — discretă, doar când doorway-ul e activ */}
        {masterDoorwayEnabled() && (
          <Link href="/master" className="mt-2 text-[11px] uppercase tracking-[0.3em] text-white/20 transition hover:text-gold/60">
            master
          </Link>
        )}
      </div>
    </main>
  );
}
