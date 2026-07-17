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
      <header className="flex items-center justify-between border-b border-white/10 bg-[#0d0d1f] px-6 py-4 text-white">
        <Link href="/" className="font-semibold">
          <span className="text-gold">Dragons</span> Delivery — Admin
        </Link>
        <nav className="flex gap-4 text-sm text-white/70">
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/menu" className="transition hover:text-white">
              Meniul meu
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/hours" className="transition hover:text-white">
              Program
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/orders" className="transition hover:text-white">
              Comenzi
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/catering" className="transition hover:text-white">
              Catering
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/earnings" className="transition hover:text-gold">
              Câștiguri
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform" className="transition hover:text-white">
              Ops
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/queues" className="transition hover:text-white">
              Cozi
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/restaurants" className="transition hover:text-white">
              Restaurante
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/couriers" className="transition hover:text-white">
              Curieri
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/orders" className="transition hover:text-white">
              Toate comenzile
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/fraud" className="transition hover:text-white">
              Semnalări
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/onboarding" className="transition hover:text-white">
              Onboarding
            </Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/payouts" className="transition hover:text-white">
              Plăți
            </Link>
          </RoleGate>
          <SignOutButton />
        </nav>
      </header>
      {children}
    </div>
  );
}
