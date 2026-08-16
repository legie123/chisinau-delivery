import Link from "next/link";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";
import type { Sector } from "@/components/immersive/sectors";

// Experiența de start a unui sector (porțile pe rol, 2026-08-14): fiecare
// rol își începe drumul pe pagina LUI, cu atmosfera lui și exact două acțiuni
// clare. Din V3 atmosfera nu mai e aleasă aici — pagina spune doar AL CUI e
// ecranul, iar `sectors.ts` știe ce se vede și cât de gros e voalul.
export type StartCta = { href: string; label: string; primary?: boolean };

export function StartHero({
  sector,
  variant,
  eyebrow,
  headline,
  sub,
  bullets,
  ctas,
}: {
  sector: Sector;
  variant?: string;
  eyebrow: string;
  headline: string;
  sub: string;
  bullets: string[];
  ctas: StartCta[];
}) {
  return (
    <main className="relative isolate flex min-h-screen flex-1 flex-col bg-[#0a0a14] text-white">
      {/* Ecranul întreg E hero-ul aici, deci fundalul umple `main`. */}
      <SectorBackdrop sector={sector} intensity="hero" variant={variant} />

      {/* `photo-caption` = umbra de text a casei, câștigată în V1 pe cardurile
          concierge: ține lizibilitatea acolo unde voalul singur n-ar ajunge,
          fără să pună o placă opacă peste imagine. Aici e necesară fiindcă
          măsurătoarea din `scripts/veil-contrast.mjs` arată că
          eticheta aurie mică nu trece de 4.5:1 pe flacără prin voal la nicio
          valoare care mai lasă video-ul să se vadă. */}
      <div className="photo-caption mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <Link href="/" className="mb-8 text-xs font-semibold uppercase tracking-[0.3em] text-white/60 transition hover:text-gold">
          ← Dragons Delivery
        </Link>
        {/* auriu plin, nu 80%: la 80% eticheta nu trece de 4.5:1 pe niciunul
            dintre cele trei assete luminoase, indiferent de voal */}
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-gold">{eyebrow}</p>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight sm:text-5xl">{headline}</h1>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-white/80">{sub}</p>

        <ul className="mt-8 flex flex-col items-center gap-2 text-sm text-white/75">
          {bullets.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <span className="text-gold" aria-hidden>✦</span>
              {b}
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {ctas.map((c) =>
            c.primary ? (
              <Link
                key={c.href}
                href={c.href}
                className="rounded-full bg-gold px-8 py-3.5 text-sm font-bold uppercase tracking-wider text-zinc-900 transition hover:bg-gold-light"
              >
                {c.label}
              </Link>
            ) : (
              <Link
                key={c.href}
                href={c.href}
                className="rounded-full border border-white/20 px-8 py-3.5 text-sm font-semibold text-white/80 transition hover:border-gold/60 hover:text-gold"
              >
                {c.label}
              </Link>
            ),
          )}
        </div>
      </div>
    </main>
  );
}
