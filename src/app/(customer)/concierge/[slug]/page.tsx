import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BookingRequestForm } from "@/components/customer/BookingRequestForm";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";
import { VENUE_META, isVenueType } from "@/lib/concierge/venues";
import { SITE_NAME, siteUrl } from "@/lib/seo/site";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("restaurants")
    .select("name, description, venue_type, cover_photo_url")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return { title: `Locație negăsită · ${SITE_NAME}` };
  const meta = isVenueType(data.venue_type) ? VENUE_META[data.venue_type] : null;
  const title = `${data.name} — ${meta?.label ?? "Locație"} în Chișinău`;
  const description = data.description ?? `Rezervă la ${data.name} prin concierge-ul Dragons Delivery Chișinău.`;

  return {
    title,
    description,
    alternates: { canonical: `${siteUrl()}/concierge/${slug}` },
    openGraph: {
      title,
      description,
      url: `${siteUrl()}/concierge/${slug}`,
      locale: "ro_MD",
      ...(data.cover_photo_url ? { images: [{ url: data.cover_photo_url, alt: data.name }] } : {}),
    },
  };
}

// Pagina unei locații din rețea. Pentru cele care și livrează (restaurant,
// sushi bar) trimitem și spre meniu — rezervarea și comanda sunt două drumuri
// din același loc, nu produse separate.
export default async function ConciergeVenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("restaurants")
    .select("id, slug, name, description, address, sector, phone, cover_photo_url, venue_type, accepting_orders")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) notFound();
  const meta = isVenueType(data.venue_type) ? VENUE_META[data.venue_type] : VENUE_META.restaurant;

  return (
    <main className="relative isolate flex-1 px-5 pb-20 pt-6">
      {/* §5: `ambient` pe pagina locului. Nivelul cel mai liniștit din contract
          — 6% opacitate, fără video, fără octeți preîncărcați — fiindcă eroul
          paginii e fotografia locului real de deasupra, nu atmosfera. Până la
          val, pagina asta era singura din concierge fără niciun substrat: se
          intra dintr-o vitrină la ora albastră direct pe navy gol. */}
      <SectorBackdrop sector="concierge" intensity="ambient" />

      <div className="mx-auto w-full max-w-3xl">
        <Link href="/concierge" className="text-xs text-white/45 transition hover:text-gold">
          ← Toate locațiile
        </Link>

        <div className="relative mt-3 h-56 overflow-hidden rounded-3xl ring-1 ring-white/10 sm:h-72">
          {data.cover_photo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={data.cover_photo_url} alt={data.name} className="h-full w-full object-cover" />
          )}
          <div className="photo-scrim absolute inset-0" />
          <div className="photo-caption absolute bottom-0 left-0 p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-gold">{meta.label}</p>
            <h1 className="mt-1 font-serif text-3xl font-bold text-white">{data.name}</h1>
            <p className="text-sm text-white/75">
              {[data.address, data.sector].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        {data.description && <p className="mt-5 text-white/70">{data.description}</p>}

        {meta.orderable && data.accepting_orders && (
          <Link
            href={`/restaurants/${data.slug}`}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-gold/40 px-5 py-2.5 text-sm font-semibold text-gold transition hover:bg-gold/10"
          >
            Vezi meniul și comandă livrare
            <span aria-hidden>→</span>
          </Link>
        )}

        <div className="mt-8">
          <BookingRequestForm venueId={data.id} venueName={data.name} defaultPurpose={meta.purpose} />
        </div>

        {data.phone && (
          <p className="mt-5 text-center text-sm text-white/40">
            Preferi să vorbești?{" "}
            <a href={`tel:${data.phone}`} className="text-gold underline underline-offset-4">
              {data.phone}
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
