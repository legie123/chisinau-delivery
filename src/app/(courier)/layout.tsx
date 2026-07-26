import Link from "next/link";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { CourierOfflineSync } from "@/components/courier/CourierOfflineSync";

export default function CourierLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-[#0a0a14] text-white">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-white/10 bg-[#0d0d1f] px-4 py-4 text-white sm:px-6">
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
