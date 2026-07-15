"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { MenuItem, Restaurant } from "@/lib/types/domain";

type Quantities = Record<string, number>;

export function CateringRequestForm({ restaurants }: { restaurants: Restaurant[] }) {
  const router = useRouter();
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [quantities, setQuantities] = useState<Quantities>({});
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [guestCount, setGuestCount] = useState(20);
  const [eventAddress, setEventAddress] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const restaurant = restaurants.find((r) => r.id === restaurantId) ?? null;

  useEffect(() => {
    if (!restaurantId) return;
    const supabase = createClient();
    supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("is_available", true)
      .order("is_catering_only", { ascending: false })
      .order("sort_order")
      .then(({ data }) => {
        setItems((data ?? []) as MenuItem[]);
        setQuantities({});
      });
  }, [restaurantId]);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (quantities[item.id] ?? 0) * item.price_mdl, 0),
    [items, quantities],
  );

  const belowMinimum =
    restaurant?.catering_min_amount_mdl != null && subtotal < restaurant.catering_min_amount_mdl;

  // No clamping while typing — Math.max on every keystroke corrupts input
  // (typing "1" toward "12" would jump to the minimum). Minimums are checked
  // at submit instead, with a clear message.
  function setQty(item: MenuItem, raw: number) {
    setQuantities((prev) => ({ ...prev, [item.id]: Math.max(0, raw) }));
  }

  const FRIENDLY_ERRORS: [string, string][] = [
    ["below minimum", "Comanda nu atinge minimul de catering al restaurantului."],
    ["not currently accepting orders", "Restaurantul nu acceptă comenzi momentan."],
    ["menu item unavailable", "Un articol din selecție nu mai este disponibil — reîncarcă pagina."],
    ["invalid quantity", "Cantitate invalidă pentru unul dintre articole."],
  ];

  function friendlyError(message: string): string {
    const hit = FRIENDLY_ERRORS.find(([needle]) => message.includes(needle));
    return hit ? hit[1] : "A apărut o eroare la trimiterea cererii. Încearcă din nou.";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const selected = items.filter((item) => (quantities[item.id] ?? 0) > 0);
    if (selected.length === 0) {
      setError("Alege cel puțin un articol pentru eveniment.");
      return;
    }
    const underMin = selected.find(
      (item) => item.catering_min_qty != null && (quantities[item.id] ?? 0) < item.catering_min_qty,
    );
    if (underMin) {
      setError(`„${underMin.name}" se comandă de la minim ${underMin.catering_min_qty} buc.`);
      return;
    }
    if (!eventDate || !eventAddress.trim() || !contactPerson.trim() || !contactPhone.trim()) {
      setError("Data, adresa evenimentului și datele de contact sunt obligatorii.");
      return;
    }
    if (eventDate < new Date().toISOString().slice(0, 10)) {
      setError("Data evenimentului nu poate fi în trecut.");
      return;
    }

    setPending(true);
    const supabase = createClient();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login?next=/catering");
        return;
      }

      const requestedFor = eventTime ? `${eventDate}T${eventTime}:00` : `${eventDate}T12:00:00`;

      const { data: orderId, error: rpcError } = await supabase.rpc("place_order", {
        p_restaurant_id: restaurantId,
        p_order_type: "catering",
        p_payment_method: "cash",
        p_items: selected.map((item) => ({ menu_item_id: item.id, quantity: quantities[item.id] })),
        p_requested_for: new Date(requestedFor).toISOString(),
        p_notes: notes.trim() || null,
        p_catering: {
          event_date: eventDate,
          event_time: eventTime || "",
          guest_count: guestCount,
          event_address_text: eventAddress.trim(),
          contact_person: contactPerson.trim(),
          contact_phone: contactPhone.trim(),
        },
      });
      if (rpcError) throw new Error(rpcError.message);

      router.push(`/catering/${orderId}`);
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : ""));
    } finally {
      setPending(false);
    }
  }

  if (restaurants.length === 0) {
    return <p className="text-white/50">Niciun restaurant nu acceptă comenzi de catering momentan.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-white/50">Restaurant</h2>
        <select
          value={restaurantId}
          onChange={(e) => setRestaurantId(e.target.value)}
          className="w-full rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-primary/60 sm:max-w-sm"
        >
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.catering_min_amount_mdl ? ` — minim ${r.catering_min_amount_mdl} MDL` : ""}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-white/50">Detalii eveniment</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Data evenimentului
            <input
              type="date"
              required
              min={new Date().toISOString().slice(0, 10)}
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ora (opțional)
            <input
              type="time"
              value={eventTime}
              onChange={(e) => setEventTime(e.target.value)}
              className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Număr de invitați
            <input
              type="number"
              min={1}
              required
              value={guestCount}
              onChange={(e) => setGuestCount(Number(e.target.value))}
              className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Adresa evenimentului (locație, sală, venue)
            <input
              required
              value={eventAddress}
              onChange={(e) => setEventAddress(e.target.value)}
              placeholder="Ex: Restaurantul Panorama, Str. Pușkin 22"
              className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Persoană de contact
            <input
              required
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Telefon de contact
            <input
              required
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+373..."
              className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
            />
          </label>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-white/50">Articole</h2>
        {items.length === 0 ? (
          <p className="text-sm text-white/50">Se încarcă meniul...</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/[0.06]"
              >
                <div>
                  <p className="font-medium">
                    {item.name}{" "}
                    {item.is_catering_only && (
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold">catering</span>
                    )}
                  </p>
                  {item.description && <p className="text-xs text-white/50">{item.description}</p>}
                  {item.catering_min_qty && item.catering_min_qty > 1 && (
                    <p className="text-xs text-white/50">Minim {item.catering_min_qty} buc.</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-white/50">{item.price_mdl} MDL</span>
                  <input
                    type="number"
                    min={0}
                    value={quantities[item.id] ?? 0}
                    onChange={(e) => setQty(item, Number(e.target.value))}
                    className="w-20 rounded-lg bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <label className="flex flex-col gap-1 text-sm">
          Note pentru restaurant (opțional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Preferințe, alergii, detalii logistice..."
            className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
          />
        </label>
      </section>

      <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
        <div className="flex justify-between text-sm">
          <span>Subtotal estimativ</span>
          <span className="font-medium">{subtotal} MDL</span>
        </div>
        {belowMinimum && restaurant?.catering_min_amount_mdl && (
          <p className="text-sm text-amber-600">
            Comanda minimă de catering la {restaurant.name} este {restaurant.catering_min_amount_mdl} MDL.
          </p>
        )}
        <p className="text-xs text-white/50">
          Trimiti o cerere de ofertă — restaurantul revine cu prețul final, pe care îl confirmi înainte ca
          comanda să intre în lucru.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending || belowMinimum}
          className="w-fit rounded-full bg-primary px-6 py-3 text-sm text-white transition hover:bg-primary-dark disabled:opacity-50"
        >
          {pending ? "Se trimite..." : "Trimite cererea de ofertă"}
        </button>
      </div>
    </form>
  );
}
