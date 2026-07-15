"use client";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-xl font-semibold">A apărut o eroare</h1>
      <p className="max-w-md text-sm text-white/50">
        Ceva n-a mers cum trebuie. Încearcă din nou — dacă persistă, reîncarcă pagina.
      </p>
      {error.digest && <p className="text-xs text-white/40">Cod: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-primary px-6 py-3 text-sm text-white transition hover:bg-primary-dark"
      >
        Încearcă din nou
      </button>
    </main>
  );
}
