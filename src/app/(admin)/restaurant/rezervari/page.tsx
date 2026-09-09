import { createClient } from "@/lib/supabase/server";
import { VenueBookingControl } from "@/components/admin/VenueBookingControl";
import { BOOKING_STATUS_LABEL, PURPOSE_LABEL, type BookingPurpose } from "@/lib/concierge/venues";

const formatWhen = new Intl.DateTimeFormat("ro-RO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Chisinau",
});

type BookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  party_size: number;
  purpose: string;
  status: string;
  quoted_price_mdl: number | null;
  contact_person: string | null;
  contact_phone: string | null;
  notes: string | null;
};

function statusTone(status: string): string {
  if (status === "confirmed") return "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25";
  if (status === "quoted") return "bg-gold/15 text-gold ring-gold/30";
  if (["declined", "cancelled"].includes(status)) return "bg-white/5 text-white/45 ring-white/10";
  return "bg-sky-400/10 text-sky-300 ring-sky-400/25";
}

function durationLabel(startsAt: string, endsAt: string): string {
  const hours = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3600_000;
  return hours >= 8 ? "toată ziua" : `${hours % 1 === 0 ? hours : hours.toFixed(1)} ${hours === 1 ? "oră" : "ore"}`;
}

// Panoul partenerului pentru rezervări. RLS (`venue_bookings_venue_read`) alege
// rândurile locației lui, deci pagina nu filtrează după restaurant.
export default async function RestaurantBookingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("venue_bookings")
    .select("id, starts_at, ends_at, party_size, purpose, status, quoted_price_mdl, contact_person, contact_phone, notes")
    .order("starts_at", { ascending: true })
    .limit(100);

  const bookings = (data ?? []) as BookingRow[];
  const active = bookings.filter((b) => ["requested", "quoted", "confirmed"].includes(b.status));
  const closed = bookings.filter((b) => !["requested", "quoted", "confirmed"].includes(b.status));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="mb-1 text-2xl font-semibold text-white">Rezervări</h1>
      <p className="mb-6 text-sm text-white/50">
        Cereri pentru spațiul tău: ședințe, mese, wellness. Pui prețul, clientul confirmă.
      </p>

      {active.length === 0 ? (
        <p className="rounded-2xl bg-white/[0.04] px-4 py-10 text-center text-sm text-white/50 ring-1 ring-white/[0.06]">
          Nicio cerere activă.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((b) => (
            <li key={b.id} className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white">
                    {formatWhen.format(new Date(b.starts_at))}
                    <span className="ml-2 text-sm font-normal text-white/50">
                      · {durationLabel(b.starts_at, b.ends_at)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-white/60">
                    {b.party_size} persoane · {PURPOSE_LABEL[b.purpose as BookingPurpose] ?? b.purpose}
                  </p>
                  {b.notes && <p className="mt-1 text-sm text-white/45">„{b.notes}&rdquo;</p>}
                  {b.contact_person && (
                    <p className="mt-1 text-sm text-white/55">
                      {b.contact_person}
                      {b.contact_phone && (
                        <>
                          {" · "}
                          <a href={`tel:${b.contact_phone}`} className="text-gold underline underline-offset-4">
                            {b.contact_phone}
                          </a>
                        </>
                      )}
                    </p>
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
              <VenueBookingControl bookingId={b.id} status={b.status} />
            </li>
          ))}
        </ul>
      )}

      {closed.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wide text-white/40">Închise</h2>
          <ul className="flex flex-col gap-2">
            {closed.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.02] px-4 py-3 text-sm ring-1 ring-white/[0.05]"
              >
                <span className="text-white/50">
                  {formatWhen.format(new Date(b.starts_at))} · {b.party_size} pers.
                </span>
                <span className="text-white/35">{BOOKING_STATUS_LABEL[b.status] ?? b.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
