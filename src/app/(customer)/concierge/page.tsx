import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { AmbientVideo } from "@/components/marketing/AmbientVideo";
import { VENUE_META, VENUE_ORDER, isVenueType, type VenueType } from "@/lib/concierge/venues";
import { SITE_NAME, siteUrl } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: "Concierge — restaurante, spa, wellness și săli de business",
  description:
    "Un singur loc pentru o întâlnire bună în Chișinău: sală de brainstorming, prânz de la restaurantele partenere, spa și wellness pentru echipă.",
  alternates: { canonical: `${siteUrl()}/concierge` },
  openGraph: {
    title: `Concierge · ${SITE_NAME}`,
    description: "Sală, masă, spa și wellness — rezervate dintr-un singur loc.",
    url: `${siteUrl()}/concierge`,
    locale: "ro_MD",
  },
};

type VenueRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sector: string | null;
  cover_photo_url: string | null;
  venue_type: string;
};

// Concierge — vitrina rețelei. Aici povestea se vede întreagă: nu „livrare de
// sushi", ci locurile din care se compune o zi de lucru bună. Sălile de business
// stau primele, fiindcă ele sunt firul care leagă restul (ședință → prânz → wellness).
export default async function ConciergePage({
  searchParams,
}: {
  searchParams: Promise<{ tip?: string }>;
}) {
  const { tip } = await searchParams;
  const activeType: VenueType | null = tip && isVenueType(tip) ? tip : null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("restaurants")
    .select("id, slug, name, description, sector, cover_photo_url, venue_type")
    .eq("is_active", true)
    .order("name");

  const venues = (data ?? []) as VenueRow[];
  const byType = new Map<VenueType, VenueRow[]>();
  for (const v of venues) {
    if (!isVenueType(v.venue_type)) continue;
    const list = byType.get(v.venue_type) ?? [];
    list.push(v);
    byType.set(v.venue_type, list);
  }
  const shownTypes = activeType ? [activeType] : VENUE_ORDER;

  return (
    <main className="relative isolate flex-1 px-5 pb-20 pt-8">
      {/* Fundal generat pentru sectorul concierge (Higgsfield/Seedance):
          lounge de business în amurg — imaginea care spune „aici se ține
          întâlnirea", nu „aici se livrează mâncare". */}
      <AmbientVideo src="/videos/hero-lounge.mp4" poster="/videos/hero-lounge-poster.jpg" />

      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-gold/80">Concierge</p>
          <h1 className="mt-3 font-serif text-4xl font-bold leading-tight sm:text-5xl">
            Locul din care pornește o întâlnire bună
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/70">
            Sala de brainstorming, prânzul pentru echipă, spa-ul de după. Ceri intervalul,
            partenerul îți trimite oferta, tu confirmi — restul ne privește pe noi.
          </p>
        </header>

        <nav aria-label="Tipuri de locații" className="mb-8 flex flex-wrap justify-center gap-2">
          <Link
            href="/concierge"
            aria-current={activeType ? undefined : "page"}
            className={`rounded-full px-4 py-1.5 text-sm ring-1 transition ${
              activeType
                ? "text-white/60 ring-white/10 hover:bg-white/5 hover:text-white"
                : "bg-gold font-semibold text-zinc-900 ring-gold"
            }`}
          >
            Toate
          </Link>
          {VENUE_ORDER.map((t) => (
            <Link
              key={t}
              href={`/concierge?tip=${t}`}
              aria-current={activeType === t ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm ring-1 transition ${
                activeType === t
                  ? "bg-gold font-semibold text-zinc-900 ring-gold"
                  : "text-white/60 ring-white/10 hover:bg-white/5 hover:text-white"
              }`}
            >
              {VENUE_META[t].plural}
            </Link>
          ))}
        </nav>

        {shownTypes.map((type) => {
          const list = byType.get(type) ?? [];
          if (list.length === 0) return null;
          const meta = VENUE_META[type];
          return (
            <section key={type} className="mb-12">
              <div className="mb-4">
                <h2 className="font-serif text-2xl font-bold text-white">{meta.plural}</h2>
                <p className="mt-0.5 text-sm text-white/50">{meta.blurb}</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((v) => (
                  <Link
                    key={v.id}
                    href={`/concierge/${v.slug}`}
                    className="group relative flex min-h-[15rem] flex-col justify-end overflow-hidden rounded-2xl ring-1 ring-white/10 transition hover:ring-gold/50"
                  >
                    {v.cover_photo_url && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={v.cover_photo_url}
                        alt={v.name}
                        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a14] via-[#0a0a14]/60 to-transparent" />
                    <div className="relative p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold/80">
                        {meta.label}
                      </p>
                      <h3 className="mt-1 font-serif text-xl font-bold text-white transition group-hover:text-gold">
                        {v.name}
                      </h3>
                      {v.sector && <p className="text-xs text-white/50">{v.sector}</p>}
                      {v.description && (
                        <p className="mt-1.5 line-clamp-2 text-sm text-white/65">{v.description}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        <p className="mt-10 text-center text-sm text-white/40">
          Ai deja o cerere trimisă?{" "}
          <Link href="/concierge/rezervari" className="text-gold underline underline-offset-4">
            Vezi rezervările tale
          </Link>
        </p>
      </div>
    </main>
  );
}
