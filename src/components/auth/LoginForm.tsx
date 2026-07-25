"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types/domain";

const ROLE_HOME: Record<UserRole, string> = {
  customer: "/restaurants",
  courier: "/deliveries",
  restaurant_partner: "/restaurant/menu",
  platform_admin: "/platform/restaurants",
};

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === "sign-up") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName, role: "customer" } },
        });
        if (signUpError) throw signUpError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Autentificare eșuată.");

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      const role = (profile?.role ?? "customer") as UserRole;
      // Only follow same-origin relative paths — never an attacker-supplied
      // absolute/protocol-relative URL (post-login open-redirect phishing).
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.push(safeNext ?? ROLE_HOME[role]);
      router.refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const friendly = raw.includes("Invalid login credentials")
        ? "Email sau parolă greșite."
        : raw.includes("already registered")
          ? "Există deja un cont cu acest email."
          : raw.includes("at least 6 characters") || raw.includes("Password should")
            ? "Parola trebuie să aibă minim 6 caractere."
            : raw.includes("valid email")
              ? "Emailul nu pare valid."
              : "A apărut o eroare. Încearcă din nou.";
      setError(friendly);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      {mode === "sign-up" && (
        <label className="flex flex-col gap-1 text-sm">
          Nume complet
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Parolă
        <input
          required
          minLength={6}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded-full bg-primary-dark px-6 py-3 text-white transition hover:bg-primary-darker disabled:opacity-50"
      >
        {loading ? "Se procesează..." : mode === "sign-up" ? "Creează cont" : "Autentificare"}
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        className="text-sm text-white/50 underline underline-offset-4"
      >
        {mode === "sign-in" ? "Nu ai cont? Creează unul." : "Ai deja cont? Autentifică-te."}
      </button>
    </form>
  );
}
