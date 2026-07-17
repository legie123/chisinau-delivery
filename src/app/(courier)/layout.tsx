import Link from "next/link";
import { SignOutButton } from "@/components/auth/SignOutButton";

export default function CourierLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-[#0a0a14] text-white">
      <header className="flex items-center justify-between border-b border-white/10 bg-[#0d0d1f] px-6 py-4 text-white">
        <Link href="/" className="font-semibold">
          <span className="text-gold">Dragons</span> Delivery — Curier
        </Link>
        <nav className="flex items-center gap-4 text-sm text-white/70">
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
      {children}
    </div>
  );
}
