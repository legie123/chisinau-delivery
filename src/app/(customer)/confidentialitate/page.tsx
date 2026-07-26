export const metadata = { title: "Politica de confidențialitate · Dragons Delivery" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl flex-1 px-5 pb-24 pt-10">
      <h1 className="font-serif text-3xl font-bold text-gold">Politica de confidențialitate</h1>
      <p className="mt-3 text-sm text-white/40">Ultima actualizare: iulie 2026</p>

      <div className="mt-8 flex flex-col gap-6 text-[15px] leading-relaxed text-white/70">
        <section>
          <h2 className="mb-2 font-semibold text-white">Ce date colectăm</h2>
          <p>
            Colectăm datele necesare livrării: nume, telefon, adresă de livrare și coordonate GPS (doar când le
            oferi), istoricul comenzilor și preferințele tale. Nu stocăm datele cardului — plățile online sunt
            procesate de furnizorul de plăți.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-semibold text-white">Cum le folosim</h2>
          <p>
            Datele sunt folosite exclusiv pentru procesarea și livrarea comenzilor, suport și îmbunătățirea
            serviciului. Adresa și poziția ta sunt partajate cu curierul alocat doar pe durata livrării active.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-semibold text-white">Drepturile tale</h2>
          <p>
            Poți solicita accesul, corectarea sau ștergerea datelor tale scriind la{" "}
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
