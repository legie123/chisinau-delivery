import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/SignOutButton";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-white/10 bg-[#0d0d1f] px-6 py-4 text-white">
        <Link href="/" className="font-semibold">
          <span className="text-gold">Dragons</span> Delivery
        </Link>
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
              <SignOutButton />
            </>
          ) : (
            <Link href="/login" className="transition hover:text-white">
              Autentificare
            </Link>
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}
