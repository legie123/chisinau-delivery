import { BrandMark } from "@/components/brand/BrandMark";
import { LoginForm } from "@/components/auth/LoginForm";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";

// §4 din rubrica vizuală cere atmosferă de sector pe DOUĂ ecrane ale
// partenerului: `/start/restaurant` și login. Al doilea lipsea — pagina era un
// navy plat, deci omul care tocmai apăsase „Am deja panou" pe o poartă în
// flăcări ateriza pe un ecran care nu semăna cu nimic din ce văzuse.
//
// Numai că `/login` NU e ecranul partenerului: `src/proxy.ts` trimite aici și
// `/deliveries/*` (curier) și `/platform/*` (admin), fiecare cu `?next=`. Un
// fundal de cuptor pus fix pe pagină ar fi fost exact „eticheta care minte" din
// regula 5 — aceeași clasă cu „Restaurant" scris pe un spa. Deci sectorul se
// DERIVĂ din destinație, nu se presupune.
//
// De ce doar restaurantul primește atmosferă acum, deși derivarea le-ar acoperi
// pe toate: filmul porții de curier are 4,15 MB, adică de aproape trei ori
// bugetul de 1,5 MB al regulii 3, iar login-ul e ecranul pe care omul are de
// TASTAT, nu de privit — n-am de gând să-i cheltui octeții ca să vadă un
// tapet. Adminul n-are sector în rubrică (sunt patru, el nu e printre ele), iar
// clientul intră aproape întotdeauna prin hub, nu pe aici. Când V9 aduce
// assetele în buget, celelalte două se aprind schimbând o linie din harta de
// mai jos — nu rescriind pagina.
const SECTOR_BY_DESTINATION = [
  { prefix: "/restaurant", sector: "restaurant" as const },
] satisfies { prefix: string; sector: "restaurant" }[];

function sectorFor(next: string | undefined) {
  if (!next || !next.startsWith("/")) return null;
  return SECTOR_BY_DESTINATION.find((m) => next.startsWith(m.prefix))?.sector ?? null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const sector = sectorFor(next);

  return (
    // `relative isolate` ca fundalul să rămână al acestei pagini, nu al
    // ferestrei; `photo-caption` e umbra de text a casei, necesară fiindcă
    // flacăra e cel mai luminos asset din contract (vezi podeaua de voal
    // măsurată în `sectors.ts`).
    <main
      className={`relative isolate flex flex-1 flex-col items-center justify-center bg-[#0a0a14] px-6 py-16 text-white ${
        sector ? "photo-caption" : ""
      }`}
    >
      {sector && <SectorBackdrop sector={sector} intensity="hero" />}
      {/* Panoul de sub formular apare DOAR când există atmosferă, și nu e o
          preferință de stil — e regula 1 („fundalul nu concurează niciodată cu
          butonul principal"), prinsă în captură înainte de commit. Câmpurile
          din `LoginForm` sunt `bg-white/5` cu text alb: peste navy sunt exact
          ce trebuie, dar peste flacără deveneau portocaliu aprins, adică un om
          ar fi tastat text alb pe galben. Contrastul TEXTELOR trecea (cel mai
          slab 5.99:1) — deci măsurătoarea singură n-ar fi prins-o; s-a văzut
          uitându-se la ecran.
          Nu e placa opacă interzisă de V1: aia acoperea fotografia ca să se
          citească un titlu. Aici atmosfera rămâne vizibilă de jur împrejur, iar
          suprafața există fiindcă un CÂMP DE INTRODUCERE are nevoie de o
          suprafață — altfel nu e câmp, e o dungă. */}
      <div
        className={
          sector
            ? "flex w-full max-w-sm flex-col items-center rounded-3xl bg-[#0a0a14]/80 px-6 py-8 ring-1 ring-white/10 backdrop-blur-sm"
            : "flex w-full max-w-sm flex-col items-center"
        }
      >
        <BrandMark size="md" />
        <h1 className="mt-3 text-xl font-bold tracking-widest text-gold">DRAGONS DELIVERY</h1>
        {/* Sub marcă scrie unde intri, nu doar că intri: cine vine de pe poarta
            partenerilor a apăsat „Am deja panou" și merită confirmarea că a
            ajuns unde voia, înainte să-și caute parola. */}
        <p className="mb-8 mt-1 text-sm text-white/60">
          {sector === "restaurant"
            ? "Panoul partenerului — autentifică-te ca să continui"
            : "Autentifică-te ca să continui"}
        </p>
        <LoginForm next={next ?? null} />
      </div>
    </main>
  );
}
