import Link from "next/link";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { CourierOfflineSync } from "@/components/courier/CourierOfflineSync";
import { RideAcceptedFocus } from "@/components/courier/RideAcceptedFocus";

export default function CourierLayout({ children }: { children: React.ReactNode }) {
  return (
    // Fără fundal opac aici: `SectorBackdrop` pune atmosfera într-un strat
    // `fixed` la `-z-10`, iar un `bg-[#0a0a14]` pe strămoș l-ar fi acoperit
    // complet — ecranul ar fi arătat identic și am fi crezut că montarea n-a
    // mers. Substratul rămâne același navy, moștenit din `body`.
    <div className="flex flex-1 flex-col text-white">
      {/* Cursa acceptată — montat în layout, nu în pagini, ca momentul să
          supraviețuiască navigării spre livrare (vezi componenta). */}
      <RideAcceptedFocus />
      <header className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-white/10 bg-[#0d0d1f]/85 px-4 py-4 text-white backdrop-blur-sm sm:px-6">
        <Link href="/" className="font-semibold">
          <span className="text-gold">Dragons</span> Delivery — Curier
        </Link>
        <nav className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/70">
          <Link href="/deliveries" className="transition hover:text-white">
            Livrările mele
          </Link>
          <Link href="/deliveries/history" className="transition hover:text-white">
            Istoric
          </Link>
          <Link href="/earnings" className="transition hover:text-gold">
            Câștiguri
          </Link>
          <SignOutButton />
        </nav>
      </header>
      {/* App-level offline drain + "N acțiuni în așteptare" banner (Wave C). */}
      <CourierOfflineSync />
      {children}
    </div>
  );
}
