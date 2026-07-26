"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cartSubtotal, useCartStore } from "@/lib/orders/cart";
import { useHydrated } from "@/hooks/useHydrated";
import type { Address, PaymentMethod } from "@/lib/types/domain";

// Persisted across a refresh/Back so an in-flight online payment RESUMES instead of
// re-rendering a blank checkout over a live cart (which re-submitted place_order and
// created duplicate orders). Keyed per browser tab. (panel BLOCKER #1)
const PAYSTEP_KEY = "chisinau-checkout-paystep";

type RestaurantSummary = { name: string; delivery_fee_mdl: number; min_order_amount_mdl: number };

type TipChoice = "none" | "p10" | "p15" | "p20";

const inputClass =
  "rounded-xl bg-white/5 px-4 py-3 text-[15px] text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60";

const TIP_OPTIONS: { key: TipChoice; label: string }[] = [
  { key: "none", label: "Fără" },
  { key: "p10", label: "10%" },
  { key: "p15", label: "15%" },
  { key: "p20", label: "20%" },
];

const PAYMENT_OPTIONS: { key: PaymentMethod; label: string; emoji: string; full: boolean }[] = [
  { key: "cash", label: "Cash", emoji: "💵", full: false },
  { key: "card_on_delivery", label: "Card (POS)", emoji: "💳", full: false },
  { key: "online_gateway", label: "Plătește online", emoji: "🔒", full: true },
];

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
  // Tipping — 4 preset chips (% of subtotal) OR a custom MDL amount that overrides them.
  const [tipChoice, setTipChoice] = useState<TipChoice>("none");
  const [customTip, setCustomTip] = useState("");
  // #10 — restore the customer's last-used payment method + tip preset so a repeat
  // checkout doesn't re-ask what they always pick. Persisted on a successful order.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from localStorage on mount */
  useEffect(() => {
    try {
      const savedPm = localStorage.getItem("chisinau-last-payment") as PaymentMethod | null;
      const savedTip = localStorage.getItem("chisinau-last-tip") as TipChoice | null;
      if (savedPm && ["cash", "card_on_delivery", "online_gateway"].includes(savedPm)) setPaymentMethod(savedPm);
      if (savedTip && ["none", "p10", "p15", "p20"].includes(savedTip)) setTipChoice(savedTip);
    } catch {
      /* storage unavailable — defaults stand */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  // Optional scheduled delivery → place_order p_requested_for (ISO).
  const [scheduled, setScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  // Online-pay mock: once an intent is open we swap the submit CTA for a confirm step.
  // The amount is FROZEN into payStep so the confirm button can't display a total that
  // differs from what the intent actually settles (panel BLOCKER #1).
  const [payStep, setPayStep] = useState<{ orderId: string; intentId: string; amount: number } | null>(null);
  // A per-checkout-attempt idempotency token: a retry (refresh/Back/re-tap) reuses it
  // so place_order returns the SAME order instead of inserting a duplicate. Lazy init
  // once — stable for the component's lifetime.
  const [idempotencyKey] = useState<string>(() =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // datetime-local min = now (local clock) — can't schedule in the past.
  const minDateTime = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);
  // Reuse a once-created address on retry so a failed place_order doesn't
  // accumulate duplicate address rows.
  const [createdAddressId, setCreatedAddressId] = useState<string | null>(null);
  // Optional GPS pin for the new address → real dropoff marker + courier navigation.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const hydrated = useHydrated();

  function captureLocation() {
    setLocationError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("Locația nu este disponibilă pe acest dispozitiv.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocationError("Nu am putut obține locația — verifică permisiunile.");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function clearLocation() {
    setCoords(null);
    setLocationError(null);
  }

  // Resume a persisted payment step after a refresh/Back so we don't re-render a
  // blank checkout (which re-submitted). If none, this is a no-op. (panel BLOCKER #1)
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(PAYSTEP_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      // One-time sync from sessionStorage on mount (resume in-flight payment).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (parsed?.orderId && parsed?.intentId) setPayStep(parsed);
    } catch {
      /* malformed — ignore */
    }
  }, []);

  useEffect(() => {
    if (!restaurantId) return;
    const supabase = createClient();
    let stale = false;
    supabase
      .from("restaurants")
      .select("name, delivery_fee_mdl, min_order_amount_mdl")
      .eq("id", restaurantId)
      .single()
      .then(({ data, error: fetchError }) => {
        if (!stale) setSummary({ forId: restaurantId, data: fetchError ? null : data });
      });
    return () => {
      stale = true;
    };
  }, [restaurantId]);

  if (!hydrated || !restaurantId || lines.length === 0) {
    return <p className="py-16 text-center text-white/60">Coșul tău este gol.</p>;
  }

  const subtotal = cartSubtotal(lines);
  const deliveryFee = restaurant?.delivery_fee_mdl ?? 0;
  // A custom amount wins; otherwise the selected preset percentage of subtotal.
  const customTipValue = Math.max(0, Math.round(Number(customTip) || 0));
  const tip =
    customTipValue > 0
      ? customTipValue
      : tipChoice === "none"
        ? 0
        : Math.round(subtotal * (tipChoice === "p10" ? 0.1 : tipChoice === "p15" ? 0.15 : 0.2));
  const total = subtotal + deliveryFee + tip;
  const belowMinimum = restaurant ? subtotal < restaurant.min_order_amount_mdl : false;

  function rememberPreferences() {
    try {
      localStorage.setItem("chisinau-last-payment", paymentMethod);
      localStorage.setItem("chisinau-last-tip", tipChoice);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();

    try {
      let deliveryAddressId = selectedAddressId === "new" ? null : selectedAddressId;

      if (selectedAddressId === "new") {
        if (!newAddress.street_address.trim()) throw new Error("Adresa este obligatorie.");
        if (createdAddressId) {
          // A previous submit already saved this address but place_order failed;
          // reuse it instead of inserting a duplicate.
          deliveryAddressId = createdAddressId;
        } else {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) throw new Error("Trebuie să fii autentificat.");

          const { data: inserted, error: addressError } = await supabase
            .from("addresses")
            .insert({ customer_id: user.id, ...newAddress, ...(coords ?? {}) })
            .select("id")
            .single();
          if (addressError) throw new Error(addressError.message);
          deliveryAddressId = inserted.id;
          setCreatedAddressId(inserted.id);
        }
      }

      let requestedForIso: string | null = null;
      if (scheduled) {
        if (!scheduledAt) throw new Error("Alege data și ora livrării.");
        const when = new Date(scheduledAt);
        if (Number.isNaN(when.getTime())) throw new Error("Ora livrării nu este validă.");
        if (when.getTime() < Date.now()) throw new Error("Ora livrării trebuie să fie în viitor.");
        requestedForIso = when.toISOString();
      }

      const { data: orderId, error: rpcError } = await supabase.rpc("place_order", {
        p_restaurant_id: restaurantId,
        p_order_type: "standard",
        p_payment_method: paymentMethod,
        p_items: lines.map((l) => ({ menu_item_id: l.menuItemId, quantity: l.quantity })),
        p_delivery_address_id: deliveryAddressId,
        p_requested_for: requestedForIso,
        // Same token on retry ⇒ place_order returns the existing order, no duplicate.
        p_idempotency_key: idempotencyKey,
      });
      if (rpcError) throw new Error(rpcError.message);

      if (paymentMethod === "online_gateway") {
        // Record the tip FIRST so the payment intent is opened for the tip-inclusive
        // total (otherwise the tip is charged short). Surface tip failures instead of
        // swallowing them. Keep the cart until the payment actually settles.
        if (tip > 0) {
          const { error: tipError } = await supabase.rpc("set_order_tip", { p_order_id: orderId, p_tip_mdl: tip });
          if (tipError) throw new Error(tipError.message);
        }
        const { data: intentId, error: payError } = await supabase.rpc("start_online_payment", {
          p_order_id: orderId,
        });
        if (payError) throw new Error(payError.message);
        // Freeze the amount + persist so the confirm total == what settles, and a
        // refresh resumes this step instead of re-submitting. (panel BLOCKER #1)
        const step = { orderId: orderId as string, intentId: intentId as string, amount: total };
        try {
          sessionStorage.setItem(PAYSTEP_KEY, JSON.stringify(step));
        } catch {
          /* private mode — in-memory state still carries the step */
        }
        setPayStep(step);
        return;
      }

      if (tip > 0) {
        const { error: tipError } = await supabase.rpc("set_order_tip", { p_order_id: orderId, p_tip_mdl: tip });
        if (tipError) throw new Error(tipError.message);
      }
      rememberPreferences();
      clear();
      router.push(`/orders/${orderId}`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const friendly = raw.includes("below minimum")
        ? "Comanda nu atinge minimul restaurantului."
        : raw.includes("not currently accepting")
          ? "Restaurantul nu acceptă comenzi momentan."
          : raw.includes("închis la ora") // #31: the place_order hours gate
            ? "Restaurantul este închis la ora selectată. Alege alt restaurant sau altă oră."
            : raw.includes("menu item unavailable")
              ? "Un articol din coș nu mai este disponibil — reîncarcă meniul."
              : raw.includes("obligatorie") || raw.includes("autentificat") || raw.includes("livrării") || raw.includes("adresa")
                ? raw
                : "Nu am putut trimite comanda. Încearcă din nou.";
      setError(friendly);
    } finally {
      setPending(false);
    }
  }

  // Mock gateway settle — the real maib/PayNet webhook will call the same RPC
  // server-side with a provider ref. On success the order flips to paid.
  async function handleConfirmPayment() {
    if (!payStep) return;
    setError(null);
    setPending(true);
    const supabase = createClient();
    try {
      const { error: confirmError } = await supabase.rpc("confirm_online_payment", {
        p_intent_id: payStep.intentId,
        p_success: true,
        p_provider_ref: `mock-${Date.now()}`,
      });
      if (confirmError) throw new Error(confirmError.message);
      try {
        sessionStorage.removeItem(PAYSTEP_KEY);
      } catch {
        /* ignore */
      }
      rememberPreferences();
      clear();
      router.push(`/orders/${payStep.orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plata nu a putut fi confirmată. Încearcă din nou.");
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
          {tip > 0 && (
            <div className="flex justify-between text-white/70">
              <span>Bacșiș curier</span>
              <span>{tip} MDL</span>
            </div>
          )}
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
              aria-label="Stradă și număr"
              placeholder="Stradă, număr"
              required
              value={newAddress.street_address}
              onChange={(e) => setNewAddress({ ...newAddress, street_address: e.target.value })}
              className={`sm:col-span-2 ${inputClass}`}
            />
            <input
              aria-label="Sector"
              placeholder="Sector"
              value={newAddress.sector}
              onChange={(e) => setNewAddress({ ...newAddress, sector: e.target.value })}
              className={inputClass}
            />
            <input
              aria-label="Bloc"
              placeholder="Bloc"
              value={newAddress.building}
              onChange={(e) => setNewAddress({ ...newAddress, building: e.target.value })}
              className={inputClass}
            />
            <input
              aria-label="Apartament"
              placeholder="Apartament"
              value={newAddress.apartment}
              onChange={(e) => setNewAddress({ ...newAddress, apartment: e.target.value })}
              className={inputClass}
            />
            <input
              aria-label="Note pentru curier"
              placeholder="Note pentru curier (interfon, etaj...)"
              value={newAddress.notes}
              onChange={(e) => setNewAddress({ ...newAddress, notes: e.target.value })}
              className={inputClass}
            />
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={captureLocation}
                  disabled={locating}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/5 px-4 py-3 text-sm text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
                >
                  {coords ? "📍 Pin salvat ✓ (schimbă)" : locating ? "Te localizăm…" : "📍 Folosește locația mea"}
                </button>
                {coords && (
                  <button
                    type="button"
                    onClick={clearLocation}
                    className="shrink-0 rounded-xl bg-white/5 px-3 py-3 text-xs text-white/60 ring-1 ring-white/10 transition hover:bg-white/10"
                  >
                    Șterge pin
                  </button>
                )}
              </div>
              {coords && (
                <p className="text-xs text-white/40">
                  Pin: {coords.lat}, {coords.lng}
                </p>
              )}
              {locationError && <p className="text-xs text-primary">{locationError}</p>}
            </div>
          </div>
        )}
      </section>

      {/* Scheduled delivery — optional, folds into place_order p_requested_for */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <button
          type="button"
          onClick={() => setScheduled((v) => !v)}
          aria-pressed={scheduled}
          className="flex w-full items-center justify-between gap-3"
        >
          <span className="text-sm font-semibold uppercase tracking-wide text-white/50">🕒 Programează livrarea</span>
          <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${scheduled ? "bg-primary" : "bg-white/15"}`}>
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${scheduled ? "left-[22px]" : "left-0.5"}`}
            />
          </span>
        </button>
        {scheduled && (
          <input
            type="datetime-local"
            value={scheduledAt}
            min={minDateTime}
            onChange={(e) => setScheduledAt(e.target.value)}
            aria-label="Data și ora livrării programate"
            className={`mt-3 w-full ${inputClass}`}
          />
        )}
      </section>

      {/* Payment card — selectable tiles */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Metodă de plată</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {PAYMENT_OPTIONS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setPaymentMethod(m.key)}
              aria-pressed={paymentMethod === m.key}
              className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-[15px] font-medium transition ${
                m.full ? "col-span-2" : ""
              } ${
                paymentMethod === m.key
                  ? "bg-primary-dark text-white"
                  : "bg-white/5 text-white/70 ring-1 ring-white/10 hover:bg-white/10"
              }`}
            >
              <span aria-hidden>{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>
        {paymentMethod === "online_gateway" && (
          <p className="mt-2.5 text-sm text-white/50">Plată securizată cu cardul — confirmată în pasul următor (demo).</p>
        )}
      </section>

      {/* Tip — presets on subtotal + custom amount */}
      <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Bacșiș pentru curier</h2>
        <div className="grid grid-cols-4 gap-2">
          {TIP_OPTIONS.map((t) => {
            const active = customTipValue === 0 && tipChoice === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTipChoice(t.key);
                  setCustomTip("");
                }}
                aria-pressed={active}
                className={`rounded-xl px-2 py-2.5 text-sm font-medium transition ${
                  active ? "bg-gold text-zinc-900" : "bg-white/5 text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={customTip}
          onChange={(e) => {
            setCustomTip(e.target.value);
            if (e.target.value) setTipChoice("none");
          }}
          aria-label="Bacșiș personalizat în MDL"
          placeholder="Alt bacșiș (MDL)"
          className={`mt-2.5 w-full ${inputClass}`}
        />
        {tip > 0 && <p className="mt-2 text-sm text-gold">Bacșiș {tip} MDL — mulțumim! 🐉</p>}
      </section>

      {error && (
        // role=alert + aria-live so screen readers announce the rejection (closed,
        // below-minimum, item unavailable) — it used to render silently. (#2/#6)
        <p role="alert" aria-live="assertive" className="rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary ring-1 ring-primary/30">
          {error}
        </p>
      )}

      {restaurantState === "error" && (
        <p className="rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary ring-1 ring-primary/30">
          Nu am putut încărca datele restaurantului — reîncarcă pagina.
        </p>
      )}

      {payStep ? (
        <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-gold/25">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gold">Plată online · demo</h2>
          <p className="mb-4 text-sm text-white/60">
            Comanda ta este creată. Simulăm gateway-ul de plată — apasă pentru a confirma plata de {payStep.amount} MDL.
          </p>
          <button
            type="button"
            onClick={handleConfirmPayment}
            disabled={pending}
            className="w-full rounded-full bg-gold py-4 text-[15px] font-semibold text-zinc-900 transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {/* Amount is the FROZEN intent amount, never the live editable total. */}
            {pending ? "Se confirmă plata..." : `🔒 Confirmă plata · ${payStep.amount} MDL`}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/orders/${payStep.orderId}`)}
            className="mx-auto mt-3 block text-sm text-white/40 underline-offset-2 transition hover:text-white/70 hover:underline"
          >
            Vezi comanda
          </button>
        </section>
      ) : (
        <button
          type="submit"
          disabled={pending || belowMinimum || restaurantState !== "ready"}
          className="rounded-full bg-primary-dark py-4 text-[15px] font-semibold text-white transition hover:bg-primary-darker disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending
            ? "Se trimite..."
            : restaurantState !== "ready"
              ? "Se calculează totalul..."
              : paymentMethod === "online_gateway"
                ? `Continuă spre plată · ${total} MDL`
                : `Plasează comanda · ${total} MDL`}
        </button>
      )}
    </form>
  );
}
