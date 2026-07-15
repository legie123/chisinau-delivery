import Link from "next/link";

export default function MarketingHome() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-[#0d0d1f] px-6 py-24 text-center text-white">
      <p className="text-sm font-semibold uppercase tracking-widest text-[#f5a623]">Dragons Delivery</p>
      <h1 className="text-4xl font-semibold tracking-tight">Chișinău Delivery</h1>
      <p className="max-w-md text-lg text-white/60">
        Sushi și fine dining, livrate proaspăt din cele mai bune restaurante din Chișinău.
      </p>
      <div className="flex gap-4">
        <Link
          href="/restaurants"
          className="rounded-full bg-[#e94560] px-6 py-3 text-white transition hover:bg-[#c73050]"
        >
          Vezi restaurantele
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-white/20 px-6 py-3 text-white transition hover:bg-white/10"
        >
          Autentificare
        </Link>
      </div>
    </main>
  );
}
