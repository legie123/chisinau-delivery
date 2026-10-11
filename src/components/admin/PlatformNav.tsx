import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { TrafficBar } from "@/components/admin/TrafficBar";

// The platform_admin branch of src/app/(admin)/layout.tsx, for the master web shell
// (apps/master). The monolith does not import this — its layout stays the source there,
// so a change to the admin header must be made in both (ponytail: fold the monolith
// layout onto this component once the shells are the only web surface).
export async function PlatformNav({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    isAdmin = profile?.role === "platform_admin";
  }

  // Same three nav badges as the monolith: pending onboarding, unreviewed fraud flags,
  // stuck orders. Only for the admin — anyone else gets RLS-empty counts anyway.
  let pendingOnboarding = 0;
  let openFraudFlags = 0;
  let stuckOrders = 0;
  if (isAdmin) {
    const [{ count: onboardingCount }, { count: fraudCount }, { count: stuckCount }] = await Promise.all([
      supabase.from("onboarding_applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("fraud_flags").select("id", { count: "exact", head: true }).is("reviewed_at", null),
      supabase.from("admin_stuck_orders").select("id", { count: "exact", head: true }),
    ]);
    pendingOnboarding = onboardingCount ?? 0;
    openFraudFlags = fraudCount ?? 0;
    stuckOrders = stuckCount ?? 0;
  }

  return (
    <div className="flex flex-1 flex-col bg-[#0a0a14] text-white">
      <header className="flex items-center gap-3 border-b border-white/10 bg-[#0d0d1f] px-4 py-4 text-white sm:px-6">
        <Link href="/" className="shrink-0 font-semibold">
          <span className="text-gold">Dragons</span> Delivery
          {isAdmin && <span className="hidden sm:inline"> — Admin</span>}
        </Link>
        <nav className="no-scrollbar flex min-w-0 flex-1 gap-4 overflow-x-auto text-sm text-white/70">
          <Link href="/platform" className="shrink-0 whitespace-nowrap transition hover:text-white">
            Ops
          </Link>
          <Link href="/platform/orders" className="shrink-0 whitespace-nowrap transition hover:text-white">
            Comenzi
            {stuckOrders > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                {stuckOrders}
              </span>
            )}
          </Link>
          <Link href="/platform/crm" className="shrink-0 whitespace-nowrap transition hover:text-white">
            CRM
            {pendingOnboarding > 0 && (
              <span className="ml-1.5 rounded-full bg-gold/20 px-1.5 py-0.5 text-[11px] font-semibold text-gold">
                {pendingOnboarding}
              </span>
            )}
          </Link>
          <Link href="/platform/payouts" className="shrink-0 whitespace-nowrap transition hover:text-white">
            Plăți
          </Link>
          <Link href="/platform/tarife" className="shrink-0 whitespace-nowrap transition hover:text-white">
            Tarife
          </Link>
          <Link href="/platform/view-as" className="shrink-0 whitespace-nowrap transition hover:text-white">
            Vezi ca
          </Link>
          <Link href="/platform/fraud" className="shrink-0 whitespace-nowrap transition hover:text-white">
            Siguranță
            {openFraudFlags > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                {openFraudFlags}
              </span>
            )}
          </Link>
          <Link href="/platform/ai" className="shrink-0 whitespace-nowrap font-semibold text-gold transition hover:text-gold-light">
            ✦ AI
          </Link>
        </nav>
        <div className="shrink-0">
          <SignOutButton />
        </div>
      </header>
      {children}
      {isAdmin && <TrafficBar />}
    </div>
  );
}
