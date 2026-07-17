import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForms } from "./OnboardingForms";
import type { OnboardingApplication } from "@/lib/types/domain";

const TYPE_LABEL: Record<string, string> = {
  courier: "Curier",
  restaurant: "Restaurant partener",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "În așteptare",
  approved: "Aprobată",
  rejected: "Respinsă",
};

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
      : status === "rejected"
        ? "bg-primary/15 text-primary ring-primary/30"
        : "bg-gold/15 text-gold ring-gold/30";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${tone}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export default async function DevinoPartenerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let existing: OnboardingApplication | null = null;
  if (user) {
    // An applicant can have at most one live (pending/approved) application —
    // if one exists we show its status instead of the forms. RLS scopes this
    // to user_id = auth.uid() already; the filter keeps it explicit.
    const { data } = await supabase
      .from("onboarding_applications")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existing = (data as OnboardingApplication | null) ?? null;
  }

  return (
    <main className="flex-1 px-5 pb-24 pt-6">
      {/* Hero */}
      <div className="mb-8 flex flex-col items-center gap-2 py-6 text-center">
        <span className="text-4xl" aria-hidden>
          🐉
        </span>
        <h1 className="font-serif text-3xl font-bold tracking-wide text-gold">Devino partener</h1>
        <p className="max-w-md text-sm text-white/55">
          Alătură-te platformei Dragons Delivery ca curier sau restaurant partener. Completează
          cererea, încarcă documentele și echipa noastră o va verifica.
        </p>
      </div>

      {!user ? (
        <div className="mx-auto max-w-md rounded-2xl bg-white/[0.04] p-6 text-center ring-1 ring-white/[0.06]">
          <p className="text-white/70">Intră în cont ca să depui o cerere de parteneriat.</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
          >
            Intră în cont
          </Link>
        </div>
      ) : existing ? (
        <div className="mx-auto max-w-md rounded-2xl bg-white/[0.04] p-6 ring-1 ring-white/[0.06]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="font-serif text-lg font-semibold text-white">Cererea ta</p>
            <StatusBadge status={existing.status} />
          </div>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-white/45">Tip</dt>
              <dd className="text-white">{TYPE_LABEL[existing.applicant_type] ?? existing.applicant_type}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-white/45">Nume</dt>
              <dd className="text-white">{existing.full_name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-white/45">Depusă</dt>
              <dd className="text-white/70">
                {new Date(existing.created_at).toLocaleDateString("ro-RO", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </dd>
            </div>
          </dl>
          {existing.status === "pending" && (
            <p className="mt-4 text-sm text-white/50">
              Cererea ta este în curs de verificare. Te anunțăm imediat ce este procesată.
            </p>
          )}
          {existing.status === "approved" && (
            <p className="mt-4 text-sm text-emerald-400">
              Felicitări! Cererea ta a fost aprobată — contul tău a fost activat.
            </p>
          )}
        </div>
      ) : (
        <div className="mx-auto max-w-2xl">
          <OnboardingForms />
        </div>
      )}
    </main>
  );
}
