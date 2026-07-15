"use client";

import { useActionState } from "react";
import { invitePartner } from "@/app/(admin)/platform/restaurants/actions";

const initialState = { error: null as string | null };

export function InvitePartnerForm({ restaurantId, restaurantName }: { restaurantId: string; restaurantName: string }) {
  const [state, formAction, pending] = useActionState(invitePartner, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="restaurant_id" value={restaurantId} />
      <input
        name="full_name"
        placeholder="Nume partener"
        required
        className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
      />
      <input
        name="email"
        type="email"
        placeholder="email@exemplu.com"
        required
        className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-50"
      >
        {pending ? "..." : `Invită partener la ${restaurantName}`}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
