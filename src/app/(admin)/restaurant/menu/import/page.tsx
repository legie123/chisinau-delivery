import Link from "next/link";
import { MenuImportForm } from "@/components/admin/MenuImportForm";

export default function MenuImportPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <div className="mb-1">
        <Link href="/restaurant/menu" className="text-xs text-white/50 transition hover:text-gold hover:underline">
          ← Înapoi la meniu
        </Link>
      </div>
      <h1 className="pg-gold-text mb-2 font-serif text-2xl font-bold">Import meniu</h1>
      <p className="mb-5 text-sm text-white/60">
        Copiază din Excel sau Google Sheets patru coloane — <strong className="text-white/80">Categorie, Produs, Descriere, Preț</strong> —
        și lipește-le mai jos. Categoriile noi se creează singure. Produsele intră <strong className="text-white/80">ascunse</strong>:
        apar la clienți după ce le adaugi fotografia și le activezi din meniu. Produsele care există deja nu se modifică.
      </p>
      <MenuImportForm />
    </main>
  );
}
