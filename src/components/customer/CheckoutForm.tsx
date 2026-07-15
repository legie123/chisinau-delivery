"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cartSubtotal, useCartStore } from "@/lib/orders/cart";
import type { Address, PaymentMethod } from "@/lib/types/domain";

type RestaurantSummary = { name: string; delivery_fee_mdl: number; min_order_amount_mdl: number };

const inputClass =
  "rounded-xl bg-white/5 px-4 py-3 text-[15px] text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60";

export function CheckoutForm({ addresses }: { addresses: Address[] }) {
  const router = useRouter();
  const { restaurantId, restaurantName, lines, clear } = useCartStore();
  const [summary, setSummary] = useState<{ forId: string; data: RestaurantSummary | null } | null>(null);
  const restaurant = summary?.forId === restaurantId ? summary.data : null;
  const restaurantState: "loading" | "error" | "ready" =
    summary?.forId === restaurantId ? (summary.data ? "ready" : "error") : "loading";
  const [selectedAddressId, setSelectedAddressId] = useState<string>(addresses[0]?.id ?? "new");
  const [newAddress, setNewAddress] = useState({ street_address: "", sector: "", building: "", apartment: "", notes: "" });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    const supabase = createClient();
    supabase
      .from("restaurants")
      .select("name, delivery_fee_mdl, min_order_amount_mdl")
      .eq("id", restaurantId)
      .single()
      .then(({ data, error: fetchError }) => {
        setSummary({ forId: restaurantId, data: fetchError ? null : data });
      });
  }, [restaurantId]);

  if (!restaurantId || lines.length === 0) {
    return <p className="py-16 text-center text-white/60">Coșul tău este gol.</p>;
  }

  const subtotal = cartSubtotal(lines);
  const deliveryFee = restaurant?.delivery_fee_mdl ?? 0;
  const total = subtotal + deliveryFee;
  const belowMinimum = restaurant ? subtotal < restaurant.min_order_amount_mdl : false;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();

    try {
      let deliveryAddressId = selectedAddressId === "new" ? null : selectedAddressId;

      if (selectedAddressId === "new") {
        if (!newAddress.street_address.trim()) throw new Error("Adresa este obligatorie.");
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Trebuie să fii autentificat.");

        const { data: inserted, error: addressError } = await supabase
          .from("addresses")
          .insert({ customer_id: user.id, ...newAddress })
          .select("id")
          .single();
        if (addressError) throw new Error(addressError.message);
        deliveryAddressId = inserted.id;
      }

      const { data: orderId, error: rpcError } = await supabase.rpc("place_order", {
        p_restaurant_id: restaurantId,
        p_order_type: "standard",
        p_payment_method: paymentMethod,
        p_items: lines.map((l) => ({ menu_item_id: l.menuItemId, quantity: l.quantity })),
        p_delivery_address_id: deliveryAddressId,
      });
      if (rpcError) throw new Error(rpcError.message);

      clear();
      router.push(`/orders/${orderId}`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const friendly = raw.includes("below minimum")
        ? "Comanda nu atinge minimul restaurantului."
        : raw.includes("not currently accepting")
          ? "Restaurantul nu acceptă comenzi momentan."
          : raw.includes("menu item unavailable")
            ? "Un articol din coș nu mai este disponibil — reîncarcă meniul."
            : raw.includes("obligatorie") || raw.includes("autentificat")
              ? raw
              : "Nu am putut trimite comanda. Încearcă din nou.";
      setError(friendly);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Order summary card */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
          Comandă de la {restaurantName}
        </h2>
        <ul className="flex flex-col gap-2 text-[15px]">
          {lines.map((l) => (
            <li key={l.menuItemId} className="flex justify-between text-white/90">
              <span>
                {l.quantity}× {l.name}
              </span>
              <span>{l.priceMdl * l.quantity} MDL</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-1.5 border-t border-white/10 pt-3 text-[15px]">
          <div className="flex justify-between text-white/70">
            <span>Subtotal</span>
            <span>{subtotal} MDL</span>
          </div>
          <div className="flex justify-between text-white/70">
            <span>Livrare</span>
            <span>{restaurantState !== "ready" ? "..." : deliveryFee === 0 ? "Gratuită" : `${deliveryFee} MDL`}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-white">
            <span>Total</span>
            <span>{restaurantState !== "ready" ? "..." : `${total} MDL`}</span>
          </div>
        </div>
        {belowMinimum && restaurant && (
          <p className="mt-3 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-400 ring-1 ring-amber-500/30">
            Comandă minimă {restaurant.min_order_amount_mdl} MDL — mai adaugă articole.
          </p>
        )}
      </section>

      {/* Address card */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Adresă de livrare</h2>
        {addresses.length > 0 && (
          <select
            value={selectedAddressId}
            onChange={(e) => setSelectedAddressId(e.target.value)}
            className={`mb-3 w-full ${inputClass}`}
          >
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label ? `${a.label} — ` : ""}
                {a.street_address}
              </option>
            ))}
            <option value="new">Adresă nouă</option>
          </select>
        )}
        {selectedAddressId === "new" && (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <input
              placeholder="Stradă, număr"
              required
              value={newAddress.street_address}
              onChange={(e) => setNewAddress({ ...newAddress, street_address: e.target.value })}
              className={`sm:col-span-2 ${inputClass}`}
            />
            <input
              placeholder="Sector"
              value={newAddress.sector}
              onChange={(e) => setNewAddress({ ...newAddress, sector: e.target.value })}
              className={inputClass}
            />
            <input
              placeholder="Bloc"
              value={newAddress.building}
              onChange={(e) => setNewAddress({ ...newAddress, building: e.target.value })}
              className={inputClass}
            />
            <input
              placeholder="Apartament"
              value={newAddress.apartment}
              onChange={(e) => setNewAddress({ ...newAddress, apartment: e.target.value })}
              className={inputClass}
            />
            <input
              placeholder="Note pentru curier (interfon, etaj...)"
              value={newAddress.notes}
              onChange={(e) => setNewAddress({ ...newAddress, notes: e.target.value })}
              className={inputClass}
            />
          </div>
        )}
      </section>

      {/* Payment card — selectable tiles */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Plată la livrare</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {(
            [
              { key: "cash", label: "Cash", emoji: "💵" },
              { key: "card_on_delivery", label: "Card (POS)", emoji: "💳" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setPaymentMethod(m.key)}
              className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-[15px] font-medium transition ${
                paymentMethod === m.key
                  ? "bg-primary text-white"
                  : "bg-white/5 text-white/70 ring-1 ring-white/10 hover:bg-white/10"
              }`}
            >
              <span aria-hidden>{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <p className="rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary ring-1 ring-primary/30">{error}</p>
      )}

      {restaurantState === "error" && (
        <p className="rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary ring-1 ring-primary/30">
          Nu am putut încărca datele restaurantului — reîncarcă pagina.
        </p>
      )}

      <button
        type="submit"
        disabled={pending || belowMinimum || restaurantState !== "ready"}
        className="rounded-full bg-primary py-4 text-[15px] font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending
          ? "Se trimite..."
          : restaurantState !== "ready"
            ? "Se calculează totalul..."
            : `Plasează comanda · ${total} MDL`}
      </button>
    </form>
  );
}
