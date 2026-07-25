"use client";

import { useState, useTransition } from "react";
import { submitRating } from "@/app/(customer)/orders/[orderId]/actions";
import type { Rating } from "@/lib/types/domain";

function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1.5" role="group" aria-label="Număr de stele">
      {[1, 2, 3, 4, 5].map((n) => {
        const lit = (hover || value) >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-pressed={value === n}
            aria-label={`${n} ${n === 1 ? "stea" : "stele"}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onChange(n)}
            className={`text-3xl leading-none transition disabled:opacity-50 ${lit ? "text-gold" : "text-white/20"}`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

function RatingBlock({
  orderId,
  target,
  title,
  existing,
}: {
  orderId: string;
  target: "restaurant" | "courier";
  title: string;
  existing?: Rating;
}) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<number | null>(existing ? existing.stars : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done !== null) {
    return (
      <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
        <p className="text-sm text-white/70">{title}</p>
        <p className="mt-1 text-gold">
          Mulțumim pentru evaluare! {"★".repeat(done)}
          <span className="text-white/20">{"★".repeat(5 - done)}</span>
        </p>
      </div>
    );
  }

  function handleSubmit() {
    if (stars < 1) {
      setError("Alege cel puțin o stea.");
      return;
    }
    startTransition(async () => {
      const result = await submitRating(orderId, target, stars, comment.trim() || undefined);
      if (result.error) setError(result.error);
      else setDone(stars);
    });
  }

  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
      <p className="mb-2 text-sm font-medium text-white">{title}</p>
      <StarPicker value={stars} onChange={setStars} disabled={pending} />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Lasă un comentariu (opțional)"
        maxLength={1000}
        rows={2}
        className="mt-3 w-full resize-none rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-gold/50"
      />
      {error && <p className="mt-1.5 text-xs text-primary">{error}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending}
        className="mt-3 rounded-full bg-primary-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
      >
        {pending ? "Se trimite..." : "Trimite evaluarea"}
      </button>
    </div>
  );
}

// WS6 — appears on the customer order page once status hits delivered.
export function RatingForm({
  orderId,
  hasCourier,
  existing,
}: {
  orderId: string;
  hasCourier: boolean;
  existing: Rating[];
}) {
  const restaurantRating = existing.find((r) => r.target_type === "restaurant");
  const courierRating = existing.find((r) => r.target_type === "courier");

  return (
    <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <h2 className="mb-3 font-serif text-lg font-semibold text-white">Evaluează comanda</h2>
      <div className="flex flex-col gap-3">
        <RatingBlock orderId={orderId} target="restaurant" title="Restaurantul" existing={restaurantRating} />
        {hasCourier && (
          <RatingBlock orderId={orderId} target="courier" title="Curierul" existing={courierRating} />
        )}
      </div>
    </section>
  );
}
