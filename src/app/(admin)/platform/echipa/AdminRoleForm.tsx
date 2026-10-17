"use client";

import { useActionState } from "react";
import { inviteAdminAction, setAdminAction } from "./actions";

const input =
  "rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60";

// Step 1: invite. Only an invited account can be promoted (admin_set_platform_admin checks
// auth.users.invited_at) — a self-registered account, even "confirmed", never becomes admin.
export function InviteAdminForm() {
  const [state, action, pending] = useActionState(inviteAdminAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <h2 className="font-medium text-white">1. Invită un viitor administrator</h2>
      <p className="text-sm text-white/50">Primește un email de invitație și își setează parola. Doar un cont invitat de aici poate primi apoi dreptul de administrator — un cont care s-a înscris singur nu poate.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/50">Email
          <input name="email" type="email" required className={input} placeholder="persoana@firma.md" />
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-white/50">Nume
          <input name="full_name" required minLength={2} className={input} placeholder="Nume Prenume" />
        </label>
        <button disabled={pending} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 disabled:opacity-50">
          {pending ? "Se trimite…" : "Trimite invitația"}
        </button>
      </div>
      {state.error && <p role="alert" className="text-sm text-primary">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-300">{state.ok}</p>}
    </form>
  );
}

export function AdminRoleForm() {
  const [state, action, pending] = useActionState(setAdminAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <h2 className="font-medium text-white">2. Acordă sau retrage dreptul de administrator</h2>
      <p className="text-sm text-white/50">Doar un cont invitat (pasul 1), care a acceptat invitația, poate deveni administrator; curierii și partenerii își primesc rolul prin înscriere. Nu îți poți schimba propriul rol.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/50">Email
          <input name="email" type="email" required className={input} placeholder="persoana@firma.md" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">Acțiune
          <select name="grant" className={input} defaultValue="true">
            <option value="true">Acordă</option>
            <option value="false">Retrage</option>
          </select>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-white/50">Motiv (rămâne în audit)
          <input name="reason" required minLength={5} className={input} placeholder="ex. dispecer nou în tura de seară" />
        </label>
        <button disabled={pending} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Se salvează…" : "Aplică"}
        </button>
      </div>
      {state.error && <p role="alert" className="text-sm text-primary">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-300">{state.ok}</p>}
    </form>
  );
}
