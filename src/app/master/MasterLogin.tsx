"use client";

import { BrandMark } from "@/components/brand/BrandMark";

// Premium master login card. Plain HTML form (works without JS) that POSTs to
// /master/auth. Shows an error line when the page passes hasError (URL ?e=1).
export function MasterLogin({ hasError }: { hasError: boolean }) {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-[#0a0a14] px-6 py-16 text-white">
      <BrandMark size="lg" />
      <h1 className="mt-4 font-serif text-3xl font-bold tracking-wide text-gold sm:text-4xl">
        DRAGON MASTER
      </h1>
      <p className="mb-8 mt-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white/45">
        Acces privat · Chișinău
      </p>

      <form
        method="POST"
        action="/master/auth"
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-white/[0.03] p-7 ring-1 ring-gold/15"
      >
        <label className="flex flex-col gap-1 text-sm text-white/80">
          Utilizator
          <input
            required
            name="user"
            autoComplete="username"
            className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 outline-none ring-1 ring-white/10 focus:ring-gold/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-white/80">
          Parolă
          <input
            required
            type="password"
            name="pass"
            autoComplete="current-password"
            className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 outline-none ring-1 ring-white/10 focus:ring-gold/60"
          />
        </label>

        {hasError && (
          <p className="text-sm text-red-400">Utilizator sau parolă greșite.</p>
        )}

        <button
          type="submit"
          className="mt-1 rounded-full bg-gold px-6 py-3 text-sm font-bold uppercase tracking-wider text-zinc-900 transition hover:bg-gold-light"
        >
          Intră
        </button>
      </form>
    </main>
  );
}
