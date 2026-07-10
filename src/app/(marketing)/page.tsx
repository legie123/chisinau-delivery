import Link from "next/link";

export default function MarketingHome() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Chișinău Delivery</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Sushi și fine dining, livrate proaspăt din cele mai bune restaurante din Chișinău.
      </p>
      <div className="flex gap-4">
        <Link
          href="/restaurants"
          className="rounded-full bg-zinc-900 px-6 py-3 text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Vezi restaurantele
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-zinc-300 px-6 py-3 transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Autentificare
        </Link>
      </div>
    </main>
  );
}
