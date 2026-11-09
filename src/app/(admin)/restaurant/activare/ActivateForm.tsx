"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, activationHashError, mapActivationError, validatePassword } from "@/lib/kitchen/activation";

// The invite / recovery link lands here with `#access_<REDACTAT-DE-GARDA:credential in clar> createClient()
// (detectSessionInUrl, the browser default) consumes the fragment at construction and writes the
// session cookies; getSession() awaits that. The proxy exempts this path from the role gate
// because the fragment never reaches the server.
type Phase = "loading" | "ready" | "dead";

const INPUT =
  "rounded-xl bg-white/5 px-4 py-2.5 text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60";

export function ActivateForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fromHash = activationHashError(window.location.hash);
    if (fromHash) {
      setError(fromHash);
      setPhase("dead");
      return;
    }
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) setPhase("ready");
        else {
          setError(mapActivationError("session missing"));
          setPhase("dead");
        }
      });
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const invalid = validatePassword(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setLoading(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) {
      setError(mapActivationError(updateError.message));
      setLoading(false);
      return;
    }
    router.push("/restaurant/orders");
    router.refresh();
  }

  if (phase === "loading") return <p className="text-sm text-white/60">Se verifică linkul de activare...</p>;
  if (phase === "dead") return <p className="text-sm text-red-400">{error}</p>;

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Parolă nouă
        <input
          required
          minLength={MIN_PASSWORD_LENGTH}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Confirmă parola
        <input
          required
          minLength={MIN_PASSWORD_LENGTH}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={INPUT}
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded-full bg-primary-dark px-6 py-3 text-white transition hover:bg-primary-darker disabled:opacity-50"
      >
        {loading ? "Se salvează..." : "Setează parola"}
      </button>
    </form>
  );
}
