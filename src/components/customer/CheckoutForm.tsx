"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmOnlinePayment, placeOrder, RpcError, setOrderTip, startOnlinePayment } from "@chisinau/shared-api";
import { PinPickerMap } from "@/components/customer/PinPickerMap";
import { placeOrderItems } from "@chisinau/shared-domain";
import { createClient } from "@/lib/supabase/client";
import { cartSubtotal, useCartStore } from "@/lib/orders/cart";
import { useCartReconcile } from "@/hooks/useCartReconcile";
import { useHydrated } from "@/hooks/useHydrated";
import type { Address, PaymentMethod } from "@/lib/types/domain";

// Persisted across a refresh/Back so an in-flight online payment RESUMES instead of
// re-rendering a blank checkout over a live cart (which re-submitted place_order and
// created duplicate orders). Keyed per browser tab. (panel BLOCKER #1)
const PAYSTEP_KEY = "chisinau-checkout-paystep";
// place_order refuses requested_for beyond now + 7 days (20261008000200).
const SCHEDULE_DAYS = 7;

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

// Pilot = COD / card-on-delivery only. Online payment is a MOCK (no real PSP) and
// its confirm RPC is service-role-gated at the DB (see confirm_online_payment),
// so the tile stays hidden until a real gateway is wired. Flip
// NEXT_PUBLIC_ENABLE_ONLINE_PAYMENT=true to re-enable once that exists.
const ONLINE_PAYMENT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ONLINE_PAYMENT === "true";
const VISIBLE_PAYMENT_OPTIONS = PAYMENT_OPTIONS.filter(
  (m) => m.key !== "online_gateway" || ONLINE_PAYMENT_ENABLED,
);

export function CheckoutForm({ addresses }: { addresses: Address[] }) {
  const router = useRouter();
  const { restaurantId, restaurantName, lines, clear } = useCartStore();
  // Audit 2026-08-11: safety net — the cart page already reconciles, but a deep
  // link straight to /checkout must also refresh prices and name dead lines.
  const reconcile = useCartReconcile();
  const deadLines = lines.filter((l) => l.unavailable);
  const [summary, setSummary] = useState<{ forId: string; data: RestaurantSummary | null } | null>(null);
  const restaurant = summary?.forId === restaurantId ? summary.data : null;
  const restaurantState: "loading" | "error" | "ready" =
    summary?.forId === restaurantId ? (summary.data ? "ready" : "error") : "loading";
  const [selectedAddressId, setSelectedAddressId] = useState<string>(addresses[0]?.id ?? "new");
  // Telefonul cerut pentru o adresă salvată care încă nu are unul.
  const [missingPhone, setMissingPhone] = useState("");
  const selectedAddress = addresses.find((a) => a.id === selectedAddressId);
  const selectedNeedsPin = selectedAddressId !== "new" && selectedAddress != null && (selectedAddress.lat == null || selectedAddress.lng == null);
  const selectedAddressHasPhone =
    selectedAddressId === "new" ||
    Boolean(addresses.find((a) => a.id === selectedAddressId)?.contact_phone);
  const [newAddress, setNewAddress] = useState({ street_address: "", sector: "", building: "", apartment: "", notes: "", contact_phone: "" });
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
      const allowedPm = ONLINE_PAYMENT_ENABLED
        ? ["cash", "card_on_delivery", "online_gateway"]
        : ["cash", "card_on_delivery"];
      if (savedPm && allowedPm.includes(savedPm)) setPaymentMethod(savedPm);
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
  // datetime-local min = now (local clock) — can't schedule in the past; max = the
  // SCHEDULE_DAYS horizon place_order enforces (20261008000200; mobile WhenPicker days=7).
  const [minDateTime, maxDateTime] = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const now = new Date();
    return [local(now), local(new Date(now.getTime() + SCHEDULE_DAYS * 86_400_000))];
  }, []);
  // Reuse a once-created address on retry so a failed place_order doesn't
  // accumulate duplicate address rows.
  const [createdAddressId, setCreatedAddressId] = useState<string | null>(null);
  // Delivery pin (C1, required by place_order): new address, or a saved one from before C1.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const hydrated = useHydrated();
  const [savedPin, setSavedPin] = useState<{ lat: number; lng: number } | null>(null);

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
  // set_order_tip refuses a tip above min(subtotal, pricing_config.tip_max_mdl) (20261008000100).
  // ponytail: mirrors the PROVISIONAL 500 of the current config version (mobile TIP_MAX_MDL too);
  // the server decides — this only stops a COD tip from being dropped silently after placement.
  const tipMax = Math.max(0, Math.min(500, Math.floor(subtotal)));
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
    if (tip > tipMax) {
      setError(`Bacșișul poate fi cel mult ${tipMax} MDL (cel mult valoarea comenzii, maxim 500 MDL).`);
      return;
    }
    setPending(true);
    const supabase = createClient();
    // Set once place_order succeeds — lets the catch distinguish a post-placement
    // failure (tip / payment-start on the online path) from a placement failure, so
    // the user never sees "order couldn't be placed" for an order that WAS placed.
    let placedOrderId: string | null = null;

    try {
      let deliveryAddressId = selectedAddressId === "new" ? null : selectedAddressId;

      if (selectedAddressId === "new") {
        if (!newAddress.street_address.trim()) throw new Error("Adresa este obligatorie.");
        if (newAddress.contact_phone.replace(/\D/g, "").length < 6) {
          throw new Error("Lasă un telefon de contact — curierul trebuie să te poată suna la livrare.");
        }
        if (!coords) throw new Error("Fixează pinul adresei pe hartă — curierul trebuie să știe exact unde livrează.");
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
      } else if (!selectedAddressHasPhone || selectedNeedsPin) {
        // Adresele salvate ÎNAINTE de 2026-08-15 n-au telefon (câmpul nu exista).
        // Fără asta, clienții vechi n-ar fi întrebați niciodată și curierul ar
        // rămâne exact la fel de blocat la poartă ca până acum.
        if (!selectedAddressHasPhone && missingPhone.replace(/\D/g, "").length < 6) {
          throw new Error("Lasă un telefon de contact — curierul trebuie să te poată suna la livrare.");
        }
        if (selectedNeedsPin && !savedPin) {
          throw new Error("Fixează pinul adresei pe hartă — curierul trebuie să știe exact unde livrează.");
        }
        const { error: phoneError } = await supabase
          .from("addresses")
          .update({
            ...(!selectedAddressHasPhone ? { contact_phone: missingPhone.trim() } : {}),
            ...(selectedNeedsPin && savedPin ? savedPin : {}),
          })
          .eq("id", selectedAddressId);
        if (phoneError) throw new Error(phoneError.message);
      }

      let requestedForIso: string | null = null;
      if (scheduled) {
        if (!scheduledAt) throw new Error("Alege data și ora livrării.");
        const when = new Date(scheduledAt);
        if (Number.isNaN(when.getTime())) throw new Error("Ora livrării nu este validă.");
        if (when.getTime() < Date.now()) throw new Error("Ora livrării trebuie să fie în viitor.");
        if (when.getTime() > Date.now() + SCHEDULE_DAYS * 86_400_000) {
          throw new Error(`Ora livrării poate fi cel mult peste ${SCHEDULE_DAYS} zile.`);
        }
        requestedForIso = when.toISOString();
      }

      // Same token on retry ⇒ place_order returns the existing order, no duplicate.
      // The wrapper throws RpcError (its .message keeps the raw pg text the catch
      // below maps to friendly Romanian copy).
      const orderId = await placeOrder(supabase, {
        restaurantId: restaurantId!,
        orderType: "standard",
        paymentMethod,
        // Same payload builder as the mobile cart (notes per dish included, trimmed).
        items: placeOrderItems(lines),
        deliveryAddressId: deliveryAddressId ?? undefined,
        requestedFor: requestedForIso ?? undefined,
        idempotencyKey,
        // The total shown above (subtotal + delivery fee): place_order refuses a different one.
        expectedTotalMdl: Math.round((subtotal + deliveryFee) * 100) / 100,
      });
      placedOrderId = orderId;

      if (paymentMethod === "online_gateway") {
        // Record the tip FIRST so the payment intent is opened for the tip-inclusive
        // total (otherwise the tip is charged short). Surface tip failures instead of
        // swallowing them. Keep the cart until the payment actually settles.
        if (tip > 0) await setOrderTip(supabase, orderId, tip);
        const intentId = await startOnlinePayment(supabase, orderId);
        // Freeze the amount + persist so the confirm total == what settles, and a
        // refresh resumes this step instead of re-submitting. (panel BLOCKER #1)
        const step = { orderId: orderId as string, intentId, amount: total };
        try {
          sessionStorage.setItem(PAYSTEP_KEY, JSON.stringify(step));
        } catch {
          /* private mode — in-memory state still carries the step */
        }
        setPayStep(step);
        return;
      }

      // COD: the order is already placed. A tip is a secondary enhancement, so a
      // tip-only failure must NOT surface as "order failed" (it did not) — proceed
      // to the order page, where the real tip (0 if it failed) is shown and can be
      // re-added. Only the primary place_order failure reaches the catch below.
      if (tip > 0) {
        try {
          await setOrderTip(supabase, orderId, tip);
        } catch {
          /* order placed; tip can be added from the order page */
        }
      }
      rememberPreferences();
      clear();
      router.push(`/orders/${orderId}`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const friendly = placedOrderId
        ? "Comanda a fost plasată, dar finalizarea plății nu a reușit. Reîncearcă — nu se creează o comandă dublă."
        : raw.includes("below minimum")
        ? "Comanda nu atinge minimul restaurantului."
        : raw.includes("not currently accepting")
          ? "Restaurantul nu acceptă comenzi momentan."
          : raw.includes("1400 MDL") // COD cap (armata 2026-08-13)
            ? "Comenzile peste 1400 MDL se achită cu cardul la livrare — alege «Card (POS)» mai jos."
            : raw.includes("închis la ora") // #31: the place_order hours gate
            ? "Restaurantul este închis la ora selectată. Alege alt restaurant sau altă oră."
            : raw.includes("prețul s-a schimbat")
            ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}. Reîncarcă pagina ca să vezi prețul actual.`
            : raw.includes("epuizat")
            ? "Un produs din coș s-a epuizat — scoate-l și reîncearcă."
            : raw.includes("fixează pinul") || raw.includes("în afara zonei")
            ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}.`
            : raw.includes("menu item unavailable")
              ? "Un articol din coș nu mai este disponibil — reîncarcă meniul."
              : raw.includes("alege o opțiune") // required modifier group not chosen (e.g. stale reorder)
                ? "Un produs are opțiuni obligatorii neconfigurate — scoate-l și adaugă-l din meniu cu opțiunile alese."
                : raw.includes("obligatorie") || raw.includes("autentificat") || raw.includes("livrării") || raw.includes("adresa") || raw.includes("programa")
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
      await confirmOnlinePayment(supabase, payStep.intentId, true, `mock-${Date.now()}`);
      try {
        sessionStorage.removeItem(PAYSTEP_KEY);
      } catch {
        /* ignore */
      }
      rememberPreferences();
      clear();
      router.push(`/orders/${payStep.orderId}`);
    } catch (err) {
      setError(err instanceof RpcError ? err.userMessage : "Plata nu a putut fi confirmată. Încearcă din nou.");
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
            <li key={l.lineId} className="flex justify-between gap-3 text-white/90">
              <span className="min-w-0">
                {l.quantity}× {l.name}
                {l.optionsLabel && <span className="block truncate text-xs text-white/40">{l.optionsLabel}</span>}
              </span>
              <span className="shrink-0">{l.priceMdl * l.quantity} MDL</span>
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
        {!selectedAddressHasPhone && (
          <div className="mt-2.5">
            <input
              aria-label="Telefon de contact"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="Telefon de contact (curierul te sună la livrare)"
              value={missingPhone}
              onChange={(e) => setMissingPhone(e.target.value)}
              className={`w-full ${inputClass}`}
            />
            <p className="mt-1 text-xs text-white/40">
              Îl salvăm pe adresa asta, ca să nu-l mai ceri data viitoare.
            </p>
          </div>
        )}
        {selectedNeedsPin && (
          <div className="mt-2.5">
            <p className="mb-2 text-xs text-gold">
              Adresa aleasă nu are pin pe hartă — fixează-l o dată, îl păstrăm pentru data viitoare.
            </p>
            <PinPickerMap value={savedPin} onChange={setSavedPin} />
          </div>
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
            {/* Telefonul e OBLIGATORIU: fără el curierul n-are cum să te sune
                dacă poarta e încuiată sau interfonul nu răspunde (armata SPOF
                2026-08-15 — până acum nu se colecta nicăieri). */}
            <input
              aria-label="Telefon de contact"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="Telefon (pentru curier)"
              required
              value={newAddress.contact_phone}
              onChange={(e) => setNewAddress({ ...newAddress, contact_phone: e.target.value })}
              className={inputClass}
            />
            <input
              aria-label="Note pentru curier"
              placeholder="Note pentru curier (interfon, etaj...)"
              value={newAddress.notes}
              onChange={(e) => setNewAddress({ ...newAddress, notes: e.target.value })}
              className={inputClass}
            />
            <div className="sm:col-span-2">
              <PinPickerMap value={coords} onChange={setCoords} />
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
            max={maxDateTime}
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
          {VISIBLE_PAYMENT_OPTIONS.map((m) => (
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

      {reconcile.repriced.length > 0 && (
        <p className="rounded-xl bg-sky-400/10 px-4 py-3 text-sm text-sky-300 ring-1 ring-sky-400/30">
          Restaurantul a actualizat prețurile: {reconcile.repriced.map((r) => `${r.name} (${r.from}→${r.to} MDL)`).join(", ")}. Totalul afișat e cel real.
        </p>
      )}
      {deadLines.length > 0 && (
        <p role="alert" className="rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary ring-1 ring-primary/30">
          Nu mai {deadLines.length === 1 ? "este disponibil" : "sunt disponibile"}: {deadLines.map((l) => l.name).join(", ")}. <a href="/cart" className="underline underline-offset-2">Elimină din coș</a> ca să continui.
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
          disabled={pending || belowMinimum || restaurantState !== "ready" || deadLines.length > 0}
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
