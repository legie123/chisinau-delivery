import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BookingActions } from "@/components/customer/BookingActions";
import { BOOKING_STATUS_LABEL, PURPOSE_LABEL, type BookingPurpose } from "@/lib/concierge/venues";

const formatWhen = new Intl.DateTimeFormat("ro-RO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Chisinau",
});

function statusTone(status: string): string {
  if (status === "confirmed") return "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25";
  if (status === "quoted") return "bg-gold/15 text-gold ring-gold/30";
  if (["declined", "cancelled"].includes(status)) return "bg-white/5 text-white/45 ring-white/10";
  return "bg-sky-400/10 text-sky-300 ring-sky-400/25";
}

type BookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  party_size: number;
  purpose: string;
  status: string;
  quoted_price_mdl: number | null;
  decline_reason: string | null;
  notes: string | null;
  restaurants: { name: string; slug: string } | null;
};

// Rezervările clientului. RLS face selecția: politica `venue_bookings_customer_read`
// întoarce doar rândurile lui, deci nu filtrăm după utilizator în query.
export default async function ConciergeBookingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex-1 px-6 py-16 text-center">
        <h1 className="mb-2 font-serif text-2xl font-bold text-white">Rezervările tale</h1>
        <p className="text-white/50">
          Intră în cont ca să vezi cererile trimise.{" "}
          <Link href="/login?next=/concierge/rezervari" className="text-gold underline underline-offset-4">
            Autentifică-te
          </Link>
        </p>
      </main>
    );
  }

  const { data } = await supabase
    .from("venue_bookings")
    .select("id, starts_at, ends_at, party_size, purpose, status, quoted_price_mdl, decline_reason, notes, restaurants(name, slug)")
    .order("starts_at", { ascending: false })
    .limit(50);

  const bookings = (data ?? []) as unknown as BookingRow[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-20 pt-8">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="font-serif text-3xl font-bold text-white">Rezervările tale</h1>
        <Link href="/concierge" className="text-sm text-gold underline underline-offset-4">
          Rezervă din nou
        </Link>
      </div>

      {bookings.length === 0 ? (
        <p className="rounded-2xl bg-white/[0.04] px-4 py-12 text-center text-sm text-white/50 ring-1 ring-white/[0.06]">
          Nicio rezervare încă.{" "}
          <Link href="/concierge" className="text-gold underline underline-offset-4">
            Vezi locațiile din rețea
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {bookings.map((b) => (
            <li key={b.id} className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-serif text-lg font-bold text-white">
                    {b.restaurants?.name ?? "Locație"}
                  </p>
                  <p className="mt-0.5 text-sm text-white/60">
                    {formatWhen.format(new Date(b.starts_at))} · {b.party_size} persoane ·{" "}
                    {PURPOSE_LABEL[b.purpose as BookingPurpose] ?? b.purpose}
                  </p>
                  {b.notes && <p className="mt-1 text-sm text-white/45">„{b.notes}"</p>}
                  {b.decline_reason && (
                    <p className="mt-1 text-sm text-primary">Motiv: {b.decline_reason}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(b.status)}`}>
                    {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                  </span>
                  {b.quoted_price_mdl != null && (
                    <span className="font-bold text-white">{b.quoted_price_mdl} MDL</span>
                  )}
                </div>
              </div>
              <BookingActions bookingId={b.id} status={b.status} priceMdl={b.quoted_price_mdl} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
