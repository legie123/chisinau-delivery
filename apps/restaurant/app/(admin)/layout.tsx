import Link from "next/link";
import { PartnerNav } from "@/components/admin/PartnerNav";
import { SignOutButton } from "@/components/auth/SignOutButton";

// App-local replacement for src/app/(admin)/layout.tsx. That layout serves /platform
// AND /restaurant by role; re-exporting it would put platform links (and the admin
// count queries) into the partner app. Same header pieces, partner branch only —
// the proxy already admits only restaurant_partner / platform_admin here.
export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-[#0a0a14] text-white">
      <header className="flex items-center gap-3 border-b border-white/10 bg-[#0d0d1f] px-4 py-4 text-white sm:px-6">
        <Link href="/" className="shrink-0 font-semibold">
          <span className="text-gold">Dragons</span> Delivery
          <span className="hidden sm:inline"> — Partener</span>
        </Link>
        <PartnerNav />
        <div className="shrink-0">
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
