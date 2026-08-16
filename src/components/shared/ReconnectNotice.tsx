// Semnalul unic pentru „legătura live a căzut, dar datele tot vin".
//
// Banda asta a fost scrisă de două ori independent (curier `OffersLive`,
// partener `OrderQueueLive`) cu ACELEAȘI culori și două plasări diferite —
// fiecare plasare câștigată printr-o captură în care varianta anterioară scria
// peste altceva. A treia oară ar fi fost o copie; aici cele două plasări devin
// un parametru, ca lecțiile să nu se piardă când apare a patra suprafață.
//
// Culoarea e chihlimbar, nu auriu: §3 al rubricii ține auriul exclusiv pentru
// bani. Nu e roșu fiindcă nu e o eroare a omului și nu-l costă nimic — e o
// stare tranzitorie a rețelei, iar recuperarea se face singură.
export type ReconnectPlacement =
  /** Curier: în flux, la începutul conținutului, lipită sus la derulare.
   *  NU `fixed top-*` (scria peste antet) și NU jos — jos e zona degetului
   *  mare, unde stau oferta și butonul de online (regula 2 a rubricii). */
  | "flow"
  /** Panou partener: colțul de jos, liber la orice lățime. Sus cădea exact
   *  peste „Program / Catering / Câștiguri" — două texte suprapuse, dovedit
   *  în captura 1440×900. */
  | "floating"
  /** În interiorul unui card care ARE deja un antet propriu (harta de
   *  ridicare): fără poziționare, ca să nu concureze cu titlul cardului. */
  | "inline";

const PLACEMENT: Record<ReconnectPlacement, string> = {
  flow: "sticky top-0 z-40 -mx-5 mb-3 flex justify-center px-5 pt-1",
  floating: "fixed bottom-4 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2",
  inline: "flex",
};

export function ReconnectNotice({
  detail,
  placement = "flow",
}: {
  /** Ce se întâmplă mai departe, în cuvintele suprafeței. Fără el, banda ar
   *  anunța o problemă fără să spună că se rezolvă singură. */
  detail: string;
  placement?: ReconnectPlacement;
}) {
  return (
    <div role="status" className={PLACEMENT[placement]}>
      <span className="rounded-full bg-amber-500/15 px-4 py-1.5 text-center text-xs font-medium text-amber-200 ring-1 ring-amber-400/30 backdrop-blur">
        Reconectare… {detail}
      </span>
    </div>
  );
}
