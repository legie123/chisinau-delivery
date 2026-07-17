"use client";

import { useState } from "react";
import { CourierApplicationForm } from "./CourierApplicationForm";
import { RestaurantApplicationForm } from "./RestaurantApplicationForm";

type Choice = "courier" | "restaurant";

const CHOICES: { value: Choice; icon: string; title: string; blurb: string }[] = [
  {
    value: "courier",
    icon: "🛵",
    title: "Devino curier",
    blurb: "Livrează în Chișinău, program flexibil, plată pe cursă.",
  },
  {
    value: "restaurant",
    icon: "👨‍🍳",
    title: "Devino restaurant partener",
    blurb: "Listează-ți meniul și primește comenzi din tot orașul.",
  },
];

export function OnboardingForms() {
  const [choice, setChoice] = useState<Choice>("courier");

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CHOICES.map((c) => {
          const active = choice === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => setChoice(c.value)}
              aria-pressed={active}
              className={`flex flex-col items-start gap-2 rounded-2xl p-5 text-left ring-1 transition ${
                active
                  ? "bg-primary/10 ring-primary/60"
                  : "bg-white/[0.04] ring-white/[0.06] hover:bg-white/[0.06]"
              }`}
            >
              <span className="text-3xl" aria-hidden>
                {c.icon}
              </span>
              <span className="font-serif text-lg font-semibold text-white">{c.title}</span>
              <span className="text-sm text-white/55">{c.blurb}</span>
            </button>
          );
        })}
      </div>

      {choice === "courier" ? <CourierApplicationForm /> : <RestaurantApplicationForm />}
    </div>
  );
}
