import { LoginForm } from "@/components/auth/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-[#0a0a14] px-6 py-16 text-white">
      <span className="text-5xl" aria-hidden>🐉</span>
      <h1 className="mt-3 text-xl font-bold tracking-widest text-gold">DRAGONS DELIVERY</h1>
      <p className="mb-8 mt-1 text-sm text-white/50">Autentifică-te ca să continui</p>
      <LoginForm next={next ?? null} />
    </main>
  );
}
