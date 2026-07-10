import Link from "next/link";

export default function CourierLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <Link href="/" className="font-semibold">
          Chișinău Delivery — Curier
        </Link>
      </header>
      {children}
    </div>
  );
}
