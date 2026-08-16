import { OnlineToggle } from "@/components/courier/OnlineToggle";

// Bara de comandă a curierului. Audit de design 2026-08-16: ecranul deschidea
// cu „Activează notificările", apoi o alertă de numerar, apoi un sondaj de
// satisfacție — iar starea online (lucrul de care depind banii) era un chip
// gri, mic, împins în dreapta sub un salut. Ierarhia era exact pe dos față de
// ce contează pentru un om aflat pe stradă, cu o singură mână liberă.
//
// Aici stau, în ordinea în care le caută el: sunt online, cât am făcut azi,
// câte curse am dus. Restul coboară sub fold.
export function CourierCommandBar({
  firstName,
  status,
  earnedToday,
  deliveriesToday,
  availableCount,
  hasActiveDelivery,
}: {
  firstName: string;
  status: string;
  earnedToday: number;
  deliveriesToday: number;
  availableCount: number;
  hasActiveDelivery: boolean;
}) {
  const online = status === "online";

  return (
    <section className="relative mb-6 overflow-hidden rounded-3xl ring-1 ring-white/10">
      {/* Filigran de brand, ca pe banda partenerului — aceeași familie vizuală. */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#16213e] via-[#0d0d1f] to-[#0a0a14]" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "radial-gradient(circle at 85% 20%, #f5a623 0%, transparent 45%)",
        }}
        aria-hidden
      />

      <div className="relative flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold/70">Tura ta</p>
            <h1 className="mt-1 truncate font-serif text-2xl font-bold text-white sm:text-3xl">{firstName}</h1>
            <p className="mt-0.5 text-sm text-white/55">
              {!online
                ? "Ești offline — treci online ca să primești comenzi"
                : hasActiveDelivery
                  ? "Ai o livrare în curs"
                  : availableCount > 0
                    ? `${availableCount} ${availableCount === 1 ? "comandă disponibilă" : "comenzi disponibile"}`
                    : "Online — aștepți prima comandă"}
            </p>
          </div>
          {/* Decizia care-i aduce bani: cea mai mare țintă de atins de pe ecran. */}
          <div className="shrink-0 scale-110 origin-top-right">
            <OnlineToggle initialStatus={status} />
          </div>
        </div>

        {/* Banii de azi — motivul pentru care omul e pe stradă. */}
        <div className="flex items-end justify-between gap-4 border-t border-white/10 pt-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">Azi ai câștigat</p>
            <p className="mt-1 text-5xl font-extrabold leading-none tracking-tight text-gold tabular-nums">
              {earnedToday}
              <span className="ml-1.5 text-xl font-semibold text-gold/70">MDL</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">Curse</p>
            <p className="mt-1 text-3xl font-extrabold leading-none text-white tabular-nums">{deliveriesToday}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
