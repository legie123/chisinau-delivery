"use client";

import { useState, useTransition } from "react";
import { submitSatisfaction } from "@/app/(courier)/deliveries/actions";

// Faza 5 #5 — weekly in-app 1-5 satisfaction pulse (go/no-go target >=4.5/5,
// Wolt benchmark 4.57/5). Shown on /deliveries once per ISO week when the
// server confirms no response yet (see DeliveriesPage); dismissible for THIS
// visit (Wolt's own weekly survey is non-blocking too) — it reappears on the
// next load until answered, never blocks any delivery action.
export function SatisfactionPrompt() {
  const [dismissed, setDismissed] = useState(false);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (dismissed || done) return null;

  function handleSubmit(n: number) {
    setStars(n);
    startTransition(async () => {
      const result = await submitSatisfaction(n);
      if (result.error) setError(result.error);
      else setDone(true);
    });
  }

  return (
    <div className="mb-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-white/80">Cum a fost săptămâna asta pentru tine ca livrator?</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Închide"
          // Măsurat 12,2×24 px: cel mai mic obiect apăsabil de pe tot sectorul
          // curier, pe ecranul unui om care ține telefonul cu o mână, în stradă
          // (§3 + regula 2). Glifa rămâne la fel, cutia ajunge la 44.
          className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-white/30 transition hover:text-white/60"
        >
          ✕
        </button>
      </div>
      <div className="mt-2.5 flex gap-1.5" role="group" aria-label="Notă 1-5">
        {[1, 2, 3, 4, 5].map((n) => {
          const lit = (hover || stars) >= n;
          return (
            <button
              key={n}
              type="button"
              disabled={pending}
              aria-label={`${n} ${n === 1 ? "stea" : "stele"}`}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => handleSubmit(n)}
              // Stelele clientului rămân aurii pe sectorul LUI — acolo auriul e
              // identitate. Aici, pe curier, auriul e rezervat banilor (§3), iar
              // un sondaj de satisfacție nu e o sumă: cinci stele aurii sub
              // cardul cu câștigul zilei sunt exact confuzia pe care regula o
              // interzice. Aprins/stins se citește la fel de bine în alb.
              // 24×24 măsurat — sub pragul de 44 al rubricii ȘI sub minimul AA
              // de 24×24 al WCAG 2.5.8 dacă socotești spațiul dintre ele. Cele
              // cinci cutii de 44px încap pe 390 (5×44 + 4×6 = 244), deci aici
              // ținta se mărește pe bune; nu se falsifică cu o zonă invizibilă,
              // fiindcă la stele lipite una de alta zonele s-ar călca și omul ar
              // da patru stele când voia cinci.
              className={`flex h-11 w-11 items-center justify-center text-2xl leading-none transition disabled:opacity-50 ${lit ? "text-white" : "text-white/20"}`}
            >
              ★
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-xs text-primary">{error}</p>}
    </div>
  );
}
