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
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      />
      <input
        name="email"
        type="email"
        placeholder="email@exemplu.com"
        required
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-3 py-1 text-xs transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {pending ? "..." : `Invită partener la ${restaurantName}`}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
