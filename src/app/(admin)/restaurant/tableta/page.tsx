import Link from "next/link";
import { TabletChecklist } from "@/components/admin/TabletChecklist";

export default function TabletSetupPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <div className="mb-1">
        <Link href="/restaurant/orders" className="text-xs text-white/50 transition hover:text-gold hover:underline">
          ← Înapoi la comenzi
        </Link>
      </div>
      <h1 className="pg-gold-text mb-2 font-serif text-2xl font-bold">Pregătește tableta</h1>
      <p className="mb-5 text-sm text-white/60">
        Deschide pagina asta pe tableta din bucătărie. Fiecare rând e verificat pe dispozitivul de acum.
      </p>
      <TabletChecklist />
    </main>
  );
}
