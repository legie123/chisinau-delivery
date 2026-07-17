import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CheckoutForm } from "@/components/customer/CheckoutForm";
import type { Address } from "@/lib/types/domain";

export default async function CheckoutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex-1 px-6 py-10">
        <h1 className="mb-2 text-2xl font-semibold">Finalizare comandă</h1>
        <p className="text-white/50">
          Intră mai întâi din sectorul Clienți.{" "}
          <Link href="/" className="underline underline-offset-4">
            Înapoi la pagina principală
          </Link>
        </p>
      </main>
    );
  }

  const { data: addresses } = await supabase
    .from("addresses")
    .select("*")
    .eq("customer_id", user.id)
    .order("is_default", { ascending: false });

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Finalizare comandă</h1>
      <CheckoutForm addresses={(addresses ?? []) as Address[]} />
    </main>
  );
}
