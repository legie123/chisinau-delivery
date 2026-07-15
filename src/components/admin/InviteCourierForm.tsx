"use client";

import { useActionState } from "react";
import { inviteCourier } from "@/app/(admin)/platform/couriers/actions";

const initialState = { error: null as string | null };

export function InviteCourierForm() {
  const [state, formAction, pending] = useActionState(inviteCourier, initialState);

  return (
    <form action={formAction} className="mb-8 flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
      <h2 className="font-medium">Invită curier</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="full_name" placeholder="Nume complet" required className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <input name="email" type="email" placeholder="email@exemplu.com" required className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <input name="phone" placeholder="+373..." required className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <select name="vehicle_type" defaultValue="car" className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60">
          <option value="bike">Bicicletă</option>
          <option value="e_bike">Bicicletă electrică</option>
          <option value="scooter">Scuter</option>
          <option value="car">Mașină</option>
          <option value="on_foot">Pe jos</option>
        </select>
      </div>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-primary px-5 py-2 text-sm text-white transition hover:bg-primary-dark disabled:opacity-50"
      >
        {pending ? "Se trimite..." : "Trimite invitația"}
      </button>
    </form>
  );
}
