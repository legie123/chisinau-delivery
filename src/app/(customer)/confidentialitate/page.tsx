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
            Colectăm datele necesare livrării: nume, telefon, adresă de livrare (inclusiv cod interfon și
            instrucțiuni de acces, dacă le oferi), coordonate GPS și istoricul comenzilor. În etapa pilot plata se
            face la livrare (numerar sau card la POS-ul curierului) — nu colectăm și nu stocăm datele cardului.
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
          <h2 className="mb-2 font-semibold text-white">Cât timp păstrăm datele</h2>
          <p className="mb-3">
            Publicăm ferestrele exacte de retenție — puțini o fac. Ștergerea rulează automat, zilnic:
          </p>
          <ul className="flex flex-col gap-1.5">
            <li className="flex justify-between gap-4 border-b border-white/[0.06] pb-1.5">
              <span>Poziția GPS a curierului</span>
              <span className="shrink-0 font-medium text-gold">2 ani</span>
            </li>
            <li className="flex justify-between gap-4 border-b border-white/[0.06] pb-1.5">
              <span>Cod interfon + note de livrare (client inactiv)</span>
              <span className="shrink-0 font-medium text-gold">1 an</span>
            </li>
            <li className="flex justify-between gap-4 border-b border-white/[0.06] pb-1.5">
              <span>Cont inactiv (fără comenzi) → anonimizat</span>
              <span className="shrink-0 font-medium text-gold">3 ani</span>
            </li>
            <li className="flex justify-between gap-4">
              <span>Istoric comenzi (evidențe fiscale obligatorii)</span>
              <span className="shrink-0 font-medium text-gold">10 ani</span>
            </li>
          </ul>
          <p className="mt-3 text-sm text-white/50">
            Ștergerea unui cont anonimizează datele personale (nume, telefon, adresă), dar păstrează comenzile în formă
            anonimă — legislația fiscală impune păstrarea 10 ani.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-semibold text-white">Drepturile tale</h2>
          <p>
            Poți solicita accesul, corectarea sau ștergerea datelor tale scriind la{" "}
            <a href="mailto:contact@dragonsdelivery.md" className="text-gold underline underline-offset-4">
              contact@dragonsdelivery.md
            </a>
            . La cerere îți anonimizăm datele personale (nume, telefon, adresă), păstrând comenzile doar în formă
            anonimă pentru evidențele financiare obligatorii.
          </p>
        </section>
      </div>
    </main>
  );
}
