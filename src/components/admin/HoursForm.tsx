"use client";

import { useActionState } from "react";
import { updateHours } from "@/app/(admin)/restaurant/hours/actions";
import type { RestaurantHours } from "@/lib/types/domain";

const initialState = { error: null as string | null };

const DAY_LABELS = ["Duminică", "Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă"];

export function HoursForm({ hours }: { hours: RestaurantHours[] }) {
  const [state, formAction, pending] = useActionState(updateHours, initialState);
  const byDay = new Map(hours.map((h) => [h.day_of_week, h]));

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {DAY_LABELS.map((label, day) => {
        const existing = byDay.get(day);
        return (
          <div key={day} className="flex items-center gap-3 text-sm">
            <span className="w-24">{label}</span>
            <input
              type="time"
              name={`day_${day}_opens`}
              defaultValue={existing?.opens_at?.slice(0, 5) ?? "11:00"}
              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
            />
            <span>–</span>
            <input
              type="time"
              name={`day_${day}_closes`}
              defaultValue={existing?.closes_at?.slice(0, 5) ?? "22:00"}
              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
            />
            <label className="flex items-center gap-1">
              <input type="checkbox" name={`day_${day}_closed`} defaultChecked={existing?.is_closed ?? false} />
              Închis
            </label>
          </div>
        );
      })}
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-primary px-5 py-2 text-sm text-white transition hover:bg-primary-dark disabled:opacity-50"
      >
        {pending ? "Se salvează..." : "Salvează programul"}
      </button>
    </form>
  );
}
