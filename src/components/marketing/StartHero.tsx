import Link from "next/link";
import { AmbientVideo } from "@/components/marketing/AmbientVideo";

// Experiența de start a unui sector (porțile pe rol, 2026-08-14): fiecare
// rol își începe drumul pe pagina LUI, cu atmosfera lui — video Higgsfield
// unde există, imagine cu drift unde nu — și exact două acțiuni clare.
export type StartCta = { href: string; label: string; primary?: boolean };

export function StartHero({
  media,
  eyebrow,
  headline,
  sub,
  bullets,
  ctas,
}: {
  media: { video?: { src: string; poster: string }; image?: string };
  eyebrow: string;
  headline: string;
  sub: string;
  bullets: string[];
  ctas: StartCta[];
}) {
  return (
    <main className="relative isolate flex min-h-screen flex-1 flex-col bg-[#0a0a14] text-white">
      {media.video ? (
        <AmbientVideo src={media.video.src} poster={media.video.poster} />
      ) : (
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- house style: plain img */}
          <img src={media.image} alt="" className="ambient-drift h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#0a0a14]/45" />
          <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#0a0a14]/85 to-transparent" />
        </div>
      )}

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <Link href="/" className="mb-8 text-xs font-semibold uppercase tracking-[0.3em] text-white/40 transition hover:text-gold">
          ← Dragons Delivery
        </Link>
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-gold/80">{eyebrow}</p>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight sm:text-5xl">{headline}</h1>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-white/70">{sub}</p>

        <ul className="mt-8 flex flex-col items-center gap-2 text-sm text-white/60">
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
