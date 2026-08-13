import { OpsChat } from "@/components/admin/OpsChat";

// Secțiunea AI a panoului de comandă — un asistent care „vede" toată
// platforma: ruta API își construiește la fiecare întrebare un snapshot viu
// (comenzi, curieri, bani, semnalări) + harta și regulile aplicației.
export default function PlatformAiPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-8 pt-8">
      <div className="mb-6 text-center">
        <h1 className="font-serif text-3xl font-bold text-gold">✦ Asistentul platformei</h1>
        <p className="mt-1 text-sm text-white/45">
          Cunoaște fiecare colț al aplicației și starea ei de acum.
        </p>
      </div>
      <div className="min-h-0 flex-1 rounded-3xl bg-white/[0.02] p-5 ring-1 ring-gold/15">
        <OpsChat />
      </div>
    </main>
  );
}
