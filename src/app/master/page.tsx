import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { BrandMark } from "@/components/brand/BrandMark";
import { MASTER_COOKIE, masterCookieValue, masterDoorwayEnabled, masterPasswordRequired } from "@/lib/master/gate";
import { MasterLogin } from "./MasterLogin";

// Never prerender: the gate (runtime env flag + master cookie) must be
// evaluated fresh on every request, so enabling the flag takes effect without
// a stale static 404 being served.
export const dynamic = "force-dynamic";

// Sector tiles — one-click entry into any role via POST /master/enter/<role>.
const SECTORS = [
  { role: "client", title: "Clienți", subtitle: "Comandă & fine dining", emoji: "🍣" },
  { role: "curier", title: "Curieri", subtitle: "Livrări & câștiguri", emoji: "🛵" },
  { role: "restaurant", title: "Restaurante", subtitle: "Meniu & comenzi", emoji: "👨‍🍳" },
  { role: "platform", title: "Master Admin", subtitle: "Centru operațional", emoji: "🛡️" },
];

export default async function MasterPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  // Feature-flagged: when disabled the doorway does not exist at all.
  if (!masterDoorwayEnabled()) notFound();

  const { e } = await searchParams;

  const cookieStore = await cookies();
  const expected = masterCookieValue();
  const cookie = cookieStore.get(MASTER_COOKIE)?.value;
  // În dezvoltare poarta e deschisă: parola se cere doar în producție.
  const authed = !masterPasswordRequired() || (expected !== null && cookie === expected);

  if (!authed) {
    return <MasterLogin hasError={e === "1"} />;
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-[#0a0a14] text-white">
      {/* Brand */}
      <div className="flex flex-col items-center gap-1 px-6 pb-8 pt-12 text-center">
        <BrandMark size="md" />
        <h1 className="font-serif text-3xl font-bold tracking-wide text-gold sm:text-4xl">
          DRAGON MASTER
        </h1>
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/45">
          Intră în orice sector, fără parolă
        </p>
      </div>

      {/* Sector tiles */}
      <div className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 gap-4 px-5 pb-8 sm:grid-cols-2 lg:grid-cols-4">
        {SECTORS.map((s) => (
          <form key={s.role} method="POST" action={`/master/enter/${s.role}`} className="contents">
            <button
              type="submit"
              className="group relative flex min-h-[240px] flex-col justify-end overflow-hidden rounded-3xl bg-gradient-to-b from-[#16213e]/60 to-[#0d0d1f] p-6 text-left ring-1 ring-gold/15 transition duration-300 hover:ring-gold/60"
            >
              <span className="text-4xl" aria-hidden>
                {s.emoji}
              </span>
              <h2 className="mt-3 font-serif text-2xl font-bold text-white transition group-hover:text-gold">
                {s.title}
              </h2>
              <p className="mt-1 text-sm text-white/60">{s.subtitle}</p>
              <span className="mt-4 inline-flex items-center gap-2 self-start rounded-full bg-gold px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-900 transition group-hover:bg-gold-light">
                Intră
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
                </svg>
              </span>
            </button>
          </form>
        ))}
      </div>

      {/* Exit master */}
      <div className="mx-auto flex w-full max-w-5xl justify-center px-5 pb-10">
        <form method="POST" action="/master/auth?logout=1">
          <button
            type="submit"
            className="rounded-full border border-white/15 px-6 py-2.5 text-xs font-semibold uppercase tracking-wider text-white/50 transition hover:border-white/30 hover:text-white/80"
          >
            Ieși din master
          </button>
        </form>
      </div>
    </main>
  );
}
