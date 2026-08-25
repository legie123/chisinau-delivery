import Link from "next/link";
import { headers } from "next/headers";
import { localNoLoginActive } from "@/lib/local/noLogin";
import { BrandMark } from "@/components/brand/BrandMark";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";
import { SectorGlyph, type Glyph } from "@/components/marketing/SectorGlyph";
import { masterDoorwayEnabled } from "@/lib/master/gate";

// Central hub — patru porți (fiecare sector își începe experiența pe
// pagina LUI de start) + intrarea de cont. Intrarea demonstrativă fără parolă
// trăiește EXCLUSIV în spatele /master (poarta cu parolă a proprietarului) —
// hub-ul public nu mai oferă nicio ușă passwordless (2026-08-14).
//
// Fiecare poartă are DOUĂ destinații, alese de modul în care rulează serverul:
//   `href`      — pâlnia publică: pagina de start a sectorului, care explică și
//                 convinge înainte de a cere ceva. Asta rămâne comportamentul
//                 site-ului real și nu se schimbă.
//   `panelHref` — panoul propriu-zis, folosit doar când login-ul e dezactivat
//                 local (cerut 2026-08-25: „din pagina asta pot intra în toate
//                 sectoarele fără login"). Un click = un sector.
const DOORS: {
  href: string;
  panelHref: string;
  title: string;
  subtitle: string;
  glyph: Glyph;
  image: string;
  tint: string;
  localOnly?: true;
}[] = [
  {
    href: "/start/client",
    panelHref: "/restaurants",
    title: "Clienți",
    subtitle: "Comandă sushi & fine dining",
    glyph: "sushi",
    image: "https://images.unsplash.com/photo-1553621042-f6e147245754?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#3d1220]/95",
  },
  {
    href: "/concierge",
    panelHref: "/concierge",
    title: "Concierge",
    subtitle: "Spa, wellness & săli de business",
    glyph: "key",
    image: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#1a2f3d]/95",
  },
  {
    href: "/start/curier",
    panelHref: "/deliveries",
    title: "Curieri",
    subtitle: "Livrări & câștiguri",
    glyph: "bag",
    image: "https://images.unsplash.com/photo-1526367790999-0150786686a2?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#16213e]/95",
  },
  {
    href: "/start/restaurant",
    panelHref: "/restaurant/orders",
    title: "Restaurante",
    subtitle: "Meniu, comenzi & catering",
    glyph: "cloche",
    image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#4a350f]/95",
  },
  {
    // A cincea poartă există DOAR local. Pe site-ul public nu apare niciun semn
    // că există un panou de administrare — aceeași logică după care până și
    // poarta /master se ascunde când nu e activată: o ușă pe care publicul n-o
    // vede nu e o ușă pe care publicul o încearcă.
    localOnly: true,
    href: "/platform",
    panelHref: "/platform",
    title: "Sistem",
    subtitle: "Centru operațional & dispecerat",
    glyph: "panels",
    image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=900&h=1200&fit=crop",
    tint: "from-[#0a0a14]/30 via-[#0a0a14]/55 to-[#2a1f3d]/95",
  },
];

export default async function HubPage() {
  // Modul local fără login se citește din antetul cererii, nu doar din mediu:
  // flagul singur n-ar dovedi că cererea vine chiar de pe mașina asta.
  const noLogin = localNoLoginActive((await headers()).get("host"));
  const doors = noLogin ? DOORS : DOORS.filter((d) => !d.localOnly);

  // `isolate` e obligatoriu: fără stacking context propriu, copilul cu -z-10
  // (fundalul de sector) cade sub fundalul opac al lui <main> și video-ul
  // devine invizibil deși rulează (bug-ul „este identic" raportat de user).
  return (
    <main className="relative isolate flex min-h-screen flex-1 flex-col bg-[#0a0a14] text-white">
      {/* Primul contact cu brandul: limbajul clientului (poftă, mâncare), în
          varianta sushi. `hero` fiindcă ecranul întreg e deschiderea. */}
      <SectorBackdrop sector="customer" intensity="hero" variant="sushi" />
      {/* Banda spune ce e ANORMAL aici, ca o captură locală să nu poată fi luată
          drept site-ul real. Fără ea, singurul semn că autentificarea e oprită
          ar fi absența ei — adică nimic. */}
      {noLogin && (
        <div
          role="status"
          className="border-b border-amber-400/25 bg-amber-500/10 px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200"
        >
          Login dezactivat · doar local · fiecare poartă intră cu contul sectorului
        </div>
      )}
      {/* Brand */}
      <div className="flex flex-col items-center gap-1 px-6 pb-6 pt-12 text-center">
        <BrandMark size="md" />
        {/* CLS măsurat, nu ghicit: la 390px containerul are 342px, wordmarkul în
            Playfair cere 316px (o linie) iar în fontul de rezervă 347px (două).
            Ratează cu CINCI pixeli, deci până sosește fontul titlul e pe două
            rânduri, iar când sosește urcă tot ce e sub el cu 36px — inclusiv cele
            patru porți, la 743 ms, exact când degetul pleacă spre un card. Ăla
            era CLS-ul de 0,0772 al hub-ului.
            `nowrap` scoate reflow-ul din ecuație structural (o linie în ORICE
            font), dar atunci mărimea trebuie să încapă pentru fontul cel mai
            LAT, nu pentru cel final — prima variantă, 28px fix, depășea cu 2px
            la 320px lățime și făcea derulare orizontală (prinsă cu rigla, nu
            presupusă). Fontul de rezervă măsoară 11,6px lățime pentru fiecare px
            de mărime (347/30, măsurat cu fonturile blocate la rețea), deci
            mărimea urmează fereastra până la plafonul de design: la 320 dă
            22,8px (263 din 272 disponibili), la 390 dă 28,8px (333 din 342).
            De la `sm` în sus containerul e larg și mărimea e cea de dinainte. */}
        <h1 className="font-serif text-[min(1.75rem,calc((100vw-3.5rem)/11.6))] font-bold tracking-wide whitespace-nowrap text-gold sm:text-4xl">
          DRAGONS DELIVERY
        </h1>
        {/* alb/45 măsura 4,40:1 la 390 și 4,43 la 1440 — sub pragul §8, pe cadrul
            cel mai luminos al sushi-ului. */}
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/70">
          Concierge premium · Chișinău
        </p>
      </div>

      {/* Porțile pe rol */}
      <div
        className={`mx-auto grid w-full flex-1 grid-cols-1 gap-4 px-5 pb-10 sm:grid-cols-2 ${
          noLogin ? "max-w-7xl lg:grid-cols-5" : "max-w-6xl lg:grid-cols-4"
        }`}
      >
        {doors.map((s) => (
          <Link
            key={s.href}
            href={noLogin ? s.panelHref : s.href}
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
              {/* Umbra e plasă, nu decor: glifa stă peste fotografie, iar pe
                  cardul de sushi cade exact pe orezul alb, unde auriul se
                  topește. Aceeași soluție ca la `.photo-caption`. */}
              <SectorGlyph
                glyph={s.glyph}
                className="h-8 w-8 text-gold drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
              />
              <h2 className="mt-3 font-serif text-3xl font-bold text-white transition group-hover:text-gold">
                {s.title}
              </h2>
              <p className="mt-1 text-sm text-white/65">{s.subtitle}</p>
              <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-900 transition group-hover:bg-gold-light">
                {noLogin ? "Intră în sector" : "Începe aici"}
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
        {/* alb/30 măsura 2,59:1 (390) și 2,31:1 (1440) — la 1440 „CONT" și
            „MASTER" cad exact peste rândul de nigiri luminos al fundalului. */}
        <div className="flex items-center gap-3 text-white/60">
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
        {/* Poarta proprietarului — discretă, doar când doorway-ul e activ.
            alb/20 măsura 1,77:1, cel mai slab text de pe hub. Poarta e ținută
            închisă de parolă, nu de opacitate — un link pe care proprietarul
            nu-l vede nu e discret, e ascuns de propriul om. */}
        {masterDoorwayEnabled() && (
          <Link href="/master" className="mt-2 text-[11px] uppercase tracking-[0.3em] text-white/60 transition hover:text-gold">
            master
          </Link>
        )}

        {/* Aici stătea un al doilea rând, „Intrare directă în sectoare", cu
            exact aceleași cinci destinații. Scos 2026-08-25 fiindcă în modul
            local porțile DE DEASUPRA duc acum ele însele în panouri: două
            rânduri cu aceleași nume, ducând în aceleași locuri, nu sunt o
            comoditate în plus, ci o întrebare la fiecare click („care din ele
            e cel adevărat?"). Când modul local e stins, porțile se întorc la
            paginile de start și nu mai există nicio scurtătură — corect, fiindcă
            acela e site-ul public. */}
      </div>
    </main>
  );
}
