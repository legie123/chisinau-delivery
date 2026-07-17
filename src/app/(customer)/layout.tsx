import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { FloatingBasket } from "@/components/customer/FloatingBasket";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col bg-[#0a0a14] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0a14]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-5">
            <Link href="/" className="font-semibold">
              <span className="text-gold">Dragons</span> Delivery
            </Link>
            <span className="hidden items-center gap-1 text-sm text-white/60 sm:flex">
              <svg className="h-4 w-4 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" />
              </svg>
              Chișinău
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm text-white/70">
            <Link href="/restaurants" className="transition hover:text-white">
              Restaurante
            </Link>
            <Link href="/catering" className="transition hover:text-white">
              Catering
            </Link>
            <Link href="/cart" className="transition hover:text-white">
              Coș
            </Link>
            {user ? (
              <>
                <Link href="/orders" className="transition hover:text-white">
                  Comenzile mele
                </Link>
                <Link href="/devino-partener" className="transition hover:text-gold">
                  Devino partener
                </Link>
                <SignOutButton />
              </>
            ) : (
              <Link href="/" className="transition hover:text-white">
                Intră în cont
              </Link>
            )}
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1">{children}</div>
      <FloatingBasket />
    </div>
  );
}
