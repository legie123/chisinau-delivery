import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RoleGate } from "@/components/auth/RoleGate";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { TrafficBar } from "@/components/admin/TrafficBar";
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

  // KYC/ops visibility (audit #14): pending onboarding + unreviewed fraud flags
  // used to be invisible unless an admin happened to click into each page.
  // Surface both as nav badges so they can't silently pile up. Stuck-order
  // count feeds the Comenzi badge (consolidare 2026-08-14).
  let pendingOnboarding = 0;
  let openFraudFlags = 0;
  let stuckOrders = 0;
  if (role === "platform_admin") {
    const [{ count: onboardingCount }, { count: fraudCount }, { count: stuckCount }] = await Promise.all([
      supabase
        .from("onboarding_applications")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
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
        {/* Grupul `(admin)` ține DOUĂ suprafețe: `/platform/*` (adminul de
            platformă) și `/restaurant/*` (partenerul). Antetul scria „— Admin"
            pentru amândouă, deci partenerul citea că e administrator al
            platformei — și se contrazicea cu propria bandă de dedesubt, care
            scrie „PARTENER RESTAURANT" (captură 1440×900, 2026-08-16).
            Eticheta urmează acum rolul real al celui care se uită. */}
        {/* Sufixul de rol apare doar de la `sm` în sus: la 390px antetul e deja
            plin, iar un cuvânt în plus mai mânca din bara de navigare, care taie
            oricum „Rezervări" (defect deschis în issues.md — nu-l agravez ca să
            repar o etichetă). Pe telefon rolul rămâne spus o dată, de banda de
            dedesubt („PARTENER RESTAURANT"), deci nimic nu se pierde. */}
        <Link href="/" className="shrink-0 font-semibold">
          <span className="text-gold">Dragons</span> Delivery
          {(role === "platform_admin" || role === "restaurant_partner") && (
            <span className="hidden sm:inline">{role === "platform_admin" ? " — Admin" : " — Partener"}</span>
          )}
        </Link>
        {/* Consolidare 2026-08-14: nav-ul e împărțit PE ROL. Adminul de
            platformă vede 6 secțiuni comasate (sub-paginile trăiesc ca tab-uri
            în interiorul lor — SectionTabs), nu 16 link-uri amestecate cu cele
            de restaurant. Partenerul de restaurant își păstrează nav-ul lui. */}
        <nav className="no-scrollbar flex min-w-0 flex-1 gap-4 overflow-x-auto text-sm text-white/70">
          {role === "platform_admin" ? (
            <>
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
            </>
          ) : (
            <>
              {/* Comenzi first — it's the SLA-driven page (7-minute auto-cancel
                  on new orders), so it gets top billing over the lower-urgency
                  menu/hours/catering management pages. */}
              <RoleGate role={role} allow={["restaurant_partner"]}>
                <Link href="/restaurant/orders" className="shrink-0 whitespace-nowrap transition hover:text-white">
                  Comenzi
                </Link>
              </RoleGate>
              <RoleGate role={role} allow={["restaurant_partner"]}>
                <Link href="/restaurant/rezervari" className="shrink-0 whitespace-nowrap transition hover:text-white">
                  Rezervări
                </Link>
              </RoleGate>
              <RoleGate role={role} allow={["restaurant_partner"]}>
                <Link href="/restaurant/menu" className="shrink-0 whitespace-nowrap transition hover:text-white">
                  Meniul meu
                </Link>
              </RoleGate>
              <RoleGate role={role} allow={["restaurant_partner"]}>
                <Link href="/restaurant/hours" className="shrink-0 whitespace-nowrap transition hover:text-white">
                  Program
                </Link>
              </RoleGate>
              <RoleGate role={role} allow={["restaurant_partner"]}>
                <Link href="/restaurant/catering" className="shrink-0 whitespace-nowrap transition hover:text-white">
                  Catering
                </Link>
              </RoleGate>
              <RoleGate role={role} allow={["restaurant_partner"]}>
                <Link href="/restaurant/earnings" className="shrink-0 whitespace-nowrap transition hover:text-gold">
                  Câștiguri
                </Link>
              </RoleGate>
              <RoleGate role={role} allow={["restaurant_partner"]}>
                <Link href="/restaurant/analytics" className="shrink-0 whitespace-nowrap transition hover:text-gold">
                  Analiză
                </Link>
              </RoleGate>
            </>
          )}
        </nav>
        <div className="shrink-0">
          <SignOutButton />
        </div>
      </header>
      {children}
      {/* Bara de trafic (cerere 2026-09-07): metrici live jos, pe TOATE
          paginile /platform — doar pentru adminul de platformă. */}
      {role === "platform_admin" && <TrafficBar />}
    </div>
  );
}
