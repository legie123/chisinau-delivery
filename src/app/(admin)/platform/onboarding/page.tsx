import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ReviewActions } from "./ReviewActions";
import type { KycDocument, OnboardingApplication, OnboardingStatus } from "@/lib/types/domain";

type ApplicationRow = OnboardingApplication & { kyc_documents: KycDocument[] };

type StatusFilter = OnboardingStatus | "all";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "În așteptare" },
  { value: "approved", label: "Aprobate" },
  { value: "rejected", label: "Respinse" },
  { value: "all", label: "Toate" },
];

const STATUS_BADGE: Record<OnboardingStatus, { label: string; tone: string }> = {
  pending: { label: "În așteptare", tone: "bg-white/5 text-white/70 ring-white/10" },
  approved: { label: "Aprobată ✓", tone: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" },
  rejected: { label: "Respinsă", tone: "bg-primary/15 text-primary ring-primary/30" },
};

const TYPE_META: Record<string, { icon: string; label: string }> = {
  courier: { icon: "🛵", label: "Curier" },
  restaurant: { icon: "👨‍🍳", label: "Restaurant" },
};

const VEHICLE_LABEL: Record<string, string> = {
  bike: "Bicicletă",
  e_bike: "E-bike",
  scooter: "Scuter",
  car: "Mașină",
};

const CUISINE_LABEL: Record<string, string> = {
  sushi: "Sushi",
  fine_dining: "Fine dining",
  other: "Altele",
};

const DOC_LABEL: Record<string, string> = {
  id_card: "Buletin de identitate",
  restaurant_contract: "Contract restaurant",
};

function detailsSummary(app: ApplicationRow): { label: string; value: string }[] {
  const d = app.details ?? {};
  if (app.applicant_type === "courier") {
    const vt = String(d.vehicle_type ?? "");
    return [{ label: "Vehicul", value: VEHICLE_LABEL[vt] ?? vt ?? "—" }];
  }
  return [
    { label: "Restaurant", value: String(d.name ?? "—") },
    { label: "Slug", value: String(d.slug ?? "—") },
    { label: "Adresă", value: String(d.address ?? "—") },
    { label: "Sector", value: String(d.sector ?? "—") },
    { label: "Bucătărie", value: CUISINE_LABEL[String(d.cuisine_type ?? "")] ?? String(d.cuisine_type ?? "—") },
    { label: "Taxă livrare", value: `${Number(d.delivery_fee_mdl ?? 0)} MDL` },
    { label: "Comandă minimă", value: `${Number(d.min_order_amount_mdl ?? 0)} MDL` },
  ];
}

export default async function PlatformOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status: StatusFilter = STATUS_TABS.some((t) => t.value === rawStatus)
    ? (rawStatus as StatusFilter)
    : "pending";

  const supabase = await createClient();

  // RLS scopes onboarding_applications/kyc_documents to platform_admin here;
  // /platform/* is also role-gated by src/proxy.ts. FK application_id drives
  // the embedded kyc_documents join. Default tab stays "pending" (the actionable
  // queue) — approved/rejected are reachable via the tabs, with their review_note.
  let query = supabase.from("onboarding_applications").select("*, kyc_documents(*)");
  if (status !== "all") query = query.eq("status", status);
  const { data } = await query.order("created_at", { ascending: false });

  const applications = (data ?? []) as ApplicationRow[];

  // Signed URLs must be minted server-side (bucket is PRIVATE). Sign every doc
  // up front, 1h validity, keyed by doc id.
  const signedUrls: Record<string, string> = {};
  await Promise.all(
    applications
      .flatMap((app) => app.kyc_documents ?? [])
      .map(async (doc) => {
        const { data: signed } = await supabase.storage
          .from("kyc-documents")
          .createSignedUrl(doc.storage_path, 3600);
        if (signed?.signedUrl) signedUrls[doc.id] = signed.signedUrl;
      }),
  );

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Onboarding</h1>
      <p className="mb-4 text-sm text-white/50">
        Cereri de parteneriat. Verifică documentele și aprobă sau respinge.
      </p>

      <nav className="mb-6 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value === "pending" ? "/platform/onboarding" : `/platform/onboarding?status=${tab.value}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ring-1 transition ${
              status === tab.value
                ? "bg-gold text-zinc-900 ring-gold"
                : "bg-white/5 text-white/60 ring-white/10 hover:bg-white/10"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {applications.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
          <span className="text-5xl" aria-hidden>
            📥
          </span>
          <p className="text-white/60">
            {status === "pending" ? "Nicio cerere în așteptare." : "Nicio cerere în această categorie."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {applications.map((app) => {
            const meta = TYPE_META[app.applicant_type] ?? { icon: "📄", label: app.applicant_type };
            const docs = app.kyc_documents ?? [];
            return (
              <section
                key={app.id}
                className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/10">
                      <span aria-hidden>{meta.icon}</span>
                      {meta.label}
                    </span>
                    <p className="mt-2 font-serif text-lg font-semibold text-white">{app.full_name}</p>
                    <p className="text-sm text-white/55">
                      {app.phone}
                      {app.email ? ` · ${app.email}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-white/35">
                      Depusă{" "}
                      {new Date(app.created_at).toLocaleString("ro-RO", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="w-full max-w-sm text-right sm:w-auto">
                    {app.status === "pending" ? (
                      <ReviewActions applicationId={app.id} />
                    ) : (
                      <>
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${STATUS_BADGE[app.status].tone}`}
                        >
                          {STATUS_BADGE[app.status].label}
                        </span>
                        {app.review_note && (
                          <p className="mt-2 max-w-xs text-xs text-white/50">{app.review_note}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                  {detailsSummary(app).map((row) => (
                    <div key={row.label} className="flex justify-between gap-3">
                      <dt className="text-white/45">{row.label}</dt>
                      <dd className="text-right text-white/85">{row.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/40">
                    Documente
                  </p>
                  {docs.length === 0 ? (
                    <p className="text-sm text-white/45">Niciun document încărcat încă.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {docs.map((doc) => {
                        const url = signedUrls[doc.id];
                        const label = DOC_LABEL[doc.doc_type] ?? doc.doc_type;
                        return (
                          <li key={doc.id}>
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-gold ring-1 ring-white/10 transition hover:bg-white/10"
                              >
                                📎 {label}
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/40 ring-1 ring-white/10">
                                📎 {label} (indisponibil)
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
