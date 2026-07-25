import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RoleGate } from "@/components/auth/RoleGate";
import { SignOutButton } from "@/components/auth/SignOutButton";
import type { UserRole } from "@/lib/types/domain";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: UserRole | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = (profile?.role as UserRole | undefined) ?? null;
  }

  return (
    <div className="flex flex-1 flex-col bg-[#0a0a14] text-white">
      <header className="flex items-center gap-3 border-b border-white/10 bg-[#0d0d1f] px-4 py-4 text-white sm:px-6">
        <Link href="/" className="shrink-0 font-semibold">
          <span className="text-gold">Dragons</span> Delivery — Admin
        </Link>
        {/* Admin has ~10 top-level links — too many to wrap without a very
            tall header, so this row scrolls horizontally instead of
            overflowing/clipping at narrow widths (brand + sign-out stay
            pinned and always reachable). */}
        <nav className="no-scrollbar flex min-w-0 flex-1 gap-4 overflow-x-auto text-sm text-white/70">
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/menu" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Meniul meu
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/hours" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Program
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/orders" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Comenzi
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/catering" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Catering
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/earnings" className="shrink-0 whitespace-nowrap transition hover:text-gold">
              Câștiguri
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Ops
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/queues" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Cozi
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/restaurants" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Restaurante
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/couriers" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Curieri
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/orders" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Toate comenzile
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/fraud" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Semnalări
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/onboarding" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Onboarding
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/payouts" className="shrink-0 whitespace-nowrap transition hover:text-white">
              Plăți
            </Link>
          </RoleGate>
        </nav>
        <div className="shrink-0">
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
