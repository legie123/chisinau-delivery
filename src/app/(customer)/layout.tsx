import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { FloatingBasket } from "@/components/customer/FloatingBasket";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col bg-[#0a0a14] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0a14]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-5">
            <Link href="/" className="font-semibold">
              <span className="text-gold">Dragons</span> Delivery
            </Link>
            <span className="hidden items-center gap-1 text-sm text-white/60 sm:flex">
              <svg className="h-4 w-4 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" />
              </svg>
              Chișinău
            </span>
          </div>
          {/* `py-1` pe fiecare link: măsurate 20px înălțime, adică sub minimul
              AA de 24×24 (WCAG 2.5.8) pe suprafața cea mai vizitată. NU merg la
              44px, și motivul e geometric, nu de lene: rândurile navigării stau
              la 28px unul de altul, deci două zone de 44px s-ar suprapune pe
              16px și degetul ar deschide „Comenzile mele" când voia „Catering".
              44 aici cere antet mai înalt sau bară de jos — decizie de layout,
              scrisă în issues.md, nu ascunsă într-un pass de accesibilitate. */}
          <nav className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/70 sm:gap-4">
            <Link href="/concierge" className="py-1 transition hover:text-gold">
              Concierge
            </Link>
            <Link href="/restaurants" className="py-1 transition hover:text-white">
              Restaurante
            </Link>
            <Link href="/catering" className="py-1 transition hover:text-white">
              Catering
            </Link>
            <Link href="/cart" className="py-1 transition hover:text-white">
              Coș
            </Link>
            {user ? (
              <>
                <Link href="/orders" className="py-1 transition hover:text-white">
                  Comenzile mele
                </Link>
                <Link href="/devino-partener" className="py-1 transition hover:text-gold">
                  Devino partener
                </Link>
                <SignOutButton />
              </>
            ) : (
              <Link href="/" className="py-1 transition hover:text-white">
                Intră în cont
              </Link>
            )}
          </nav>
        </div>
      </header>
      {/* Podeaua de o fereastră NU e decor — e reparația unui CLS de 0,558
          măsurat (`scripts/media-budget.mjs`, prag „slab" la Google = 0,25).
          Paginile de client își iau datele din Supabase, deci Next trimite
          întâi învelișul (antet + subsol) și abia apoi, pe același răspuns,
          conținutul — `template id="B:0"` se vede în HTML-ul de la
          `/restaurants`. Până sosea, subsolul se așeza la y=373 din 844, adică
          FIX pe ecran, iar la sosire era împins la y=4000+: singurul lucru
          vizibil pe pagină sărea cu o înălțime de ecran. Rezervarea unei
          ferestre pentru conținut îl scoate sub fold de la primul cadru, deci
          mutarea lui nu mai are cum să se vadă. */}
      <div className="mx-auto min-h-svh w-full max-w-5xl flex-1">{children}</div>

      {/* #5 — legal/contact footprint so first-timers can see who's behind the
          brand and how to reach support. A premium storefront needs this to be
          trusted at all. */}
      <footer className="mt-16 border-t border-white/10 bg-[#08080f]">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-5 py-10 sm:grid-cols-3">
          <div>
            <p className="font-serif text-lg font-bold text-gold">Dragons Delivery</p>
            <p className="mt-2 text-sm text-white/50">
              Livrare premium în Chișinău — sushi, fine dining și catering pentru evenimente.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-white/80">Companie</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-white/50">
              <li>Dragons Alliance SRL</li>
              <li>Chișinău, Republica Moldova</li>
              <li>
                <a href="mailto:contact@dragonsdelivery.md" className="transition hover:text-white">
                  contact@dragonsdelivery.md
                </a>
              </li>
              <li>
                <a href="tel:+37360000000" className="transition hover:text-white">
                  +373 60 000 000
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-white/80">Legal</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-white/50">
              <li>
                <Link href="/termeni" className="transition hover:text-white">
                  Termeni și condiții
                </Link>
              </li>
              <li>
                <Link href="/confidentialitate" className="transition hover:text-white">
                  Politica de confidențialitate
                </Link>
              </li>
              <li>
                <Link href="/cum-functioneaza" className="transition hover:text-white">
                  Cum funcționează
                </Link>
              </li>
              <li>
                <Link href="/devino-partener" className="transition hover:text-gold">
                  Devino partener
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/5 px-5 py-4 text-center text-xs text-white/30">
          © 2026 Dragons Alliance SRL. Toate drepturile rezervate.
        </div>
      </footer>

      <FloatingBasket />
    </div>
  );
}
