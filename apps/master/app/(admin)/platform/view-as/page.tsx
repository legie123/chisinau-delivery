import { createClient } from "@/lib/supabase/server";
import type { ViewAsApp } from "@/lib/viewAs/token";

// "Vezi ca" picker — master shell only (the monolith has no view-as). Lists the users whose surface
// can be opened read-only; each start is a POST to /master/view-as/start with a mandatory reason,
// and every session is a row in view_as_sessions (the audit, also shown below).

const SURFACE: { role: string; app: ViewAsApp; title: string }[] = [
  { role: "customer", app: "client", title: "Clienți" },
  { role: "courier", app: "curier", title: "Curieri" },
  { role: "restaurant_partner", app: "restaurant", title: "Parteneri restaurant" },
];

const ERRORS: Record<string, string> = { expirat: "Sesiunea de vizualizare a expirat sau s-a încheiat." };

const when = new Intl.DateTimeFormat("ro-RO", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Chisinau" });

export default async function ViewAsPickerPage({ searchParams }: { searchParams: Promise<{ q?: string; e?: string }> }) {
  const { q = "", e } = await searchParams;
  const supabase = await createClient();

  let users = supabase
    .from("profiles")
    .select("id, full_name, phone, role")
    .in("role", SURFACE.map((s) => s.role))
    .order("full_name")
    .limit(60);
  // Letters, digits, spaces, "+" only: the term goes into a PostgREST or() filter string.
  const term = q.replace(/[^\p{L}\p{N}+ ]/gu, " ").trim();
  if (term) users = users.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);

  const [{ data: people }, { data: recent }] = await Promise.all([
    users,
    supabase
      .from("view_as_sessions")
      .select("id, target_app, started_at, expires_at, ended_at, reason, target:profiles!view_as_sessions_target_user_id_fkey(full_name)")
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold">Vezi ca</h1>
      <p className="mt-1 text-sm text-white/60">
        Deschide suprafața unui utilizator exact cum o vede el — doar citire, 15 minute, cu motiv scris. Orice
        modificare e refuzată de baza de date.
      </p>
      {e && (
        <p role="alert" className="mt-4 rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary">
          {ERRORS[e] ?? e}
        </p>
      )}

      <form className="mt-5 flex gap-2" action="/platform/view-as">
        <input
          name="q"
          defaultValue={q}
          placeholder="Caută după nume sau telefon"
          className="min-w-0 flex-1 rounded-xl bg-white/5 px-4 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-gold/50"
        />
        <button className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20">Caută</button>
      </form>

      {SURFACE.map((s) => {
        const rows = (people ?? []).filter((p) => p.role === s.role);
        return (
          <section key={s.role} className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
              {s.title} <span className="text-white/30">({rows.length})</span>
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {rows.length === 0 && <li className="text-sm text-white/40">Niciun rezultat.</li>}
              {rows.map((p) => (
                <li key={p.id} className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/[0.06]">
                  <form method="POST" action="/master/view-as/start" className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="target" value={p.id} />
                    <input type="hidden" name="app" value={s.app} />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {p.full_name || "Fără nume"}
                      {p.phone && <span className="ml-2 text-xs text-white/40">{p.phone}</span>}
                    </span>
                    <input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                      aria-label={`Motivul vizualizării pentru ${p.full_name || "utilizator"}`}
                      placeholder="Motiv (ex.: tichet suport #123)"
                      className="w-full rounded-lg bg-white/5 px-3 py-1.5 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-gold/50 sm:w-64"
                    />
                    <button className="rounded-full bg-gold px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-900 transition hover:bg-gold-light">
                      Vezi ca
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">Ultimele tale vizualizări</h2>
        <ul className="mt-3 flex flex-col gap-1 text-sm text-white/70">
          {(recent ?? []).length === 0 && <li className="text-white/40">Niciuna încă.</li>}
          {(recent ?? []).map((r) => {
            const target = r.target as unknown as { full_name: string | null } | null;
            const state = r.ended_at ? "încheiată" : new Date(r.expires_at) < new Date() ? "expirată" : "activă";
            return (
              <li key={r.id}>
                {when.format(new Date(r.started_at))} · {target?.full_name ?? "—"} ({r.target_app}) · {state} ·{" "}
                <span className="text-white/45">{r.reason}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
