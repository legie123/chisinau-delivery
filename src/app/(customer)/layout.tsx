import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { FloatingBasket } from "@/components/customer/FloatingBasket";
import { AppTabBar } from "@/components/customer/AppTabBar";
import { InstallAppPrompt } from "@/components/customer/InstallAppPrompt";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col bg-[#0a0a14] pb-[var(--tabbar-h)] text-white [--tabbar-h:calc(4rem_+_env(safe-area-inset-bottom))] sm:[--tabbar-h:0px]">
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
          {/* Pe telefon navigarea stă în bara de jos (`AppTabBar`, ținte de 64px);
              aici rămâne doar contul. Pe ecran mare linkurile au `py-1`: 20px
              înălțime măsurată, sub minimul AA de 24×24 (WCAG 2.5.8), dar acolo
              ținta e cursorul, nu degetul. */}
          <nav className="flex items-center gap-x-3 text-sm text-white/70 sm:gap-4">
            <Link href="/concierge" className="hidden py-1 transition hover:text-gold sm:inline">
              Concierge
            </Link>
            <Link href="/restaurants" className="hidden py-1 transition hover:text-white sm:inline">
              Restaurante
            </Link>
            <Link href="/catering" className="hidden py-1 transition hover:text-white sm:inline">
              Catering
            </Link>
            <Link href="/cart" className="hidden py-1 transition hover:text-white sm:inline">
              Coș
            </Link>
            {user ? (
              <>
                <Link href="/orders" className="hidden py-1 transition hover:text-white sm:inline">
                  Comenzile mele
                </Link>
                <Link href="/devino-partener" className="hidden py-1 transition hover:text-gold sm:inline">
                  Devino partener
                </Link>
                <SignOutButton />
              </>
            ) : (
              <Link href="/" className="py-3 transition hover:text-white sm:py-1">
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
      <InstallAppPrompt />
      <AppTabBar signedIn={!!user} />
    </div>
  );
}
