export const metadata = { title: "Termeni și condiții · Dragons Delivery" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl flex-1 px-5 pb-24 pt-10">
      <h1 className="font-serif text-3xl font-bold text-gold">Termeni și condiții</h1>
      <p className="mt-3 text-sm text-white/40">Ultima actualizare: iulie 2026</p>

      <div className="mt-8 flex flex-col gap-6 text-[15px] leading-relaxed text-white/70">
        <section>
          <h2 className="mb-2 font-semibold text-white">1. Serviciul</h2>
          <p>
            Dragons Delivery (operat de Dragons Alliance SRL, Chișinău) este o platformă de intermediere
            care conectează clienți, restaurante partenere și curieri pentru livrarea de mâncare și servicii
            de catering în Chișinău.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-semibold text-white">2. Comenzi și plăți</h2>
          <p>
            Prețurile sunt afișate în lei moldovenești (MDL) și includ taxa de livrare acolo unde se aplică.
            Plata se poate face cu numerar sau card la livrare, ori online. Confirmarea comenzii nu garantează
            disponibilitatea; restaurantul poate refuza o comandă, caz în care nu se percepe nicio sumă.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-semibold text-white">3. Anulare</h2>
          <p>
            O comandă poate fi anulată de client înainte de confirmarea restaurantului. După confirmare,
            anularea se face doar prin suport, conform politicii comerciale.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-semibold text-white">4. Contact</h2>
          <p>
            Pentru orice întrebare:{" "}
            <a href="mailto:contact@dragonsdelivery.md" className="text-gold underline underline-offset-4">
              contact@dragonsdelivery.md
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
