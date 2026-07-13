"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cartSubtotal, useCartStore } from "@/lib/orders/cart";
import type { Address, PaymentMethod } from "@/lib/types/domain";

type RestaurantSummary = { name: string; delivery_fee_mdl: number; min_order_amount_mdl: number };

export function CheckoutForm({ addresses }: { addresses: Address[] }) {
  const router = useRouter();
  const { restaurantId, restaurantName, lines, clear } = useCartStore();
  const [restaurant, setRestaurant] = useState<RestaurantSummary | null>(null);
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
      .then(({ data }) => setRestaurant(data));
  }, [restaurantId]);

  if (!restaurantId || lines.length === 0) {
    return <p className="text-zinc-500">Coșul tău este gol.</p>;
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
      setError(err instanceof Error ? err.message : "A apărut o eroare.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Comandă de la {restaurantName}</h2>
        <ul className="mb-2 flex flex-col gap-1 text-sm">
          {lines.map((l) => (
            <li key={l.menuItemId} className="flex justify-between">
              <span>
                {l.quantity}× {l.name}
              </span>
              <span>{l.priceMdl * l.quantity} MDL</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1 border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{subtotal} MDL</span>
          </div>
          <div className="flex justify-between">
            <span>Livrare</span>
            <span>{deliveryFee} MDL</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span>{total} MDL</span>
          </div>
        </div>
        {belowMinimum && restaurant && (
          <p className="mt-2 text-sm text-amber-600">
            Comandă minimă {restaurant.min_order_amount_mdl} MDL — mai adaugă articole.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Adresă de livrare</h2>
        {addresses.length > 0 && (
          <select
            value={selectedAddressId}
            onChange={(e) => setSelectedAddressId(e.target.value)}
            className="mb-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              placeholder="Stradă, număr"
              required
              value={newAddress.street_address}
              onChange={(e) => setNewAddress({ ...newAddress, street_address: e.target.value })}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm sm:col-span-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              placeholder="Sector"
              value={newAddress.sector}
              onChange={(e) => setNewAddress({ ...newAddress, sector: e.target.value })}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              placeholder="Bloc"
              value={newAddress.building}
              onChange={(e) => setNewAddress({ ...newAddress, building: e.target.value })}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              placeholder="Apartament"
              value={newAddress.apartment}
              onChange={(e) => setNewAddress({ ...newAddress, apartment: e.target.value })}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              placeholder="Note pentru curier"
              value={newAddress.notes}
              onChange={(e) => setNewAddress({ ...newAddress, notes: e.target.value })}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Plată</h2>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="payment_method"
              checked={paymentMethod === "cash"}
              onChange={() => setPaymentMethod("cash")}
            />
            Cash la livrare
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="payment_method"
              checked={paymentMethod === "card_on_delivery"}
              onChange={() => setPaymentMethod("card_on_delivery")}
            />
            Card la livrare
          </label>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending || belowMinimum}
        className="w-fit rounded-full bg-primary px-6 py-3 text-sm text-white transition hover:bg-primary-dark disabled:opacity-50"
      >
        {pending ? "Se trimite..." : "Plasează comanda"}
      </button>
    </form>
  );
}
