"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestVenueBooking } from "@chisinau/shared-api";
import { createClient } from "@/lib/supabase/client";
import { PURPOSE_LABEL, type BookingPurpose } from "@/lib/concierge/venues";

// Cererea de rezervare: ora de început + durata, nu două câmpuri de dată —
// nimeni nu gândește „de la 14:00 până la 16:00", ci „la 14, două ore".
const DURATIONS = [
  { hours: 1, label: "1 oră" },
  { hours: 2, label: "2 ore" },
  { hours: 3, label: "3 ore" },
  { hours: 4, label: "jumătate de zi" },
  { hours: 8, label: "toată ziua" },
];

export function BookingRequestForm({
  venueId,
  venueName,
  defaultPurpose,
}: {
  venueId: string;
  venueName: string;
  defaultPurpose: BookingPurpose;
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [hours, setHours] = useState(2);
  const [partySize, setPartySize] = useState(8);
  const [purpose, setPurpose] = useState<BookingPurpose>(defaultPurpose);
  const [contactPerson, setContactPerson] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const FRIENDLY: [string, string][] = [
    ["în viitor", "Alege o dată și o oră din viitor."],
    ["nu este disponibilă", "Locația nu mai primește rezervări momentan."],
    ["contact", "Lasă o persoană și un telefon de contact."],
  ];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!date || !time) {
      setError("Alege data și ora.");
      return;
    }
    if (!contactPerson.trim() || contactPhone.replace(/\D/g, "").length < 6) {
      setError("Lasă o persoană de contact și un telefon valid.");
      return;
    }

    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setError("Data și ora trebuie să fie în viitor.");
      return;
    }
    const endsAt = new Date(startsAt.getTime() + hours * 3600_000);

    setPending(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/login?next=/concierge`);
        return;
      }

      await requestVenueBooking(supabase, {
        venueId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        partySize,
        purpose,
        contactPerson: contactPerson.trim(),
        contactPhone: contactPhone.trim(),
        notes: notes.trim() || undefined,
      });
      router.push("/concierge/rezervari");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const hit = FRIENDLY.find(([needle]) => raw.includes(needle));
      setError(hit ? hit[1] : "Nu am putut trimite cererea. Încearcă din nou.");
    } finally {
      setPending(false);
    }
  }

  const field =
    "w-full rounded-xl bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-white/30 ring-1 ring-white/10 outline-none transition focus:ring-gold/50";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/[0.08]">
      <h2 className="font-serif text-xl font-bold text-white">Rezervă la {venueName}</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Data
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Ora
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Durata
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={field}>
            {DURATIONS.map((d) => (
              <option key={d.hours} value={d.hours}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Câte persoane
          <input
            type="number"
            min={1}
            max={500}
            required
            value={partySize}
            onChange={(e) => setPartySize(Math.max(1, Number(e.target.value)))}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50 sm:col-span-2">
          Pentru ce
          <select value={purpose} onChange={(e) => setPurpose(e.target.value as BookingPurpose)} className={field}>
            {(Object.keys(PURPOSE_LABEL) as BookingPurpose[]).map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Persoană de contact
          <input
            required
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="Nume și prenume"
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Telefon
          <input
            type="tel"
            inputMode="tel"
            required
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="+373…"
            className={field}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-white/50">
        Detalii (opțional)
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Proiector, așezare în U, cafea la sosire, catering pentru pauză…"
          className={`${field} resize-none`}
        />
      </label>

      {error && <p className="text-sm text-primary">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-gold px-6 py-3 text-sm font-bold uppercase tracking-wider text-zinc-900 transition hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Se trimite…" : "Cere ofertă"}
      </button>
      <p className="text-center text-xs text-white/35">
        Nu se plătește nimic acum — primești oferta și decizi.
      </p>
    </form>
  );
}
