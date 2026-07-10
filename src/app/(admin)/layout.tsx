import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RoleGate } from "@/components/auth/RoleGate";
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
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <Link href="/" className="font-semibold">
          Chișinău Delivery — Admin
        </Link>
        <nav className="flex gap-4 text-sm">
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/menu">Meniul meu</Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/hours">Program</Link>
          </RoleGate>
          <RoleGate role={role} allow={["restaurant_partner", "platform_admin"]}>
            <Link href="/restaurant/orders">Comenzi</Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/restaurants">Restaurante</Link>
          </RoleGate>
          <RoleGate role={role} allow={["platform_admin"]}>
            <Link href="/platform/couriers">Curieri</Link>
          </RoleGate>
        </nav>
      </header>
      {children}
    </div>
  );
}
