import Link from "next/link";

// Audit 2026-08-13 HIGH: notFound() used to fall through to Next's default
// English boundary ("This page could not be found") — untranslated, no way
// back, and unbranded. Every route group now has a localized boundary with
// a CTA pointing at that role's home.
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-24 text-center">
      <span className="text-6xl" aria-hidden>🐉</span>
      <h1 className="font-serif text-3xl font-bold text-gold">Livrarea nu există</h1>
      <p className="max-w-md text-white/60">Poate a fost reasignată sau linkul e vechi.</p>
      <Link
        href="/deliveries"
        className="mt-2 rounded-full bg-primary-dark px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-darker"
      >
        Înapoi la livrările tale
      </Link>
    </main>
  );
}
