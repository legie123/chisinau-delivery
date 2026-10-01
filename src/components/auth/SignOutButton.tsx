"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function handleSignOut() {
    setFailed(false);
    startTransition(async () => {
      // Lazy: this button sits in every sector header; a static import put
      // supabase-js in the initial JS of every page that shows it. A failed
      // chunk load (weak signal) is the same "retry" state as a network error.
      let supabase;
      try {
        const { createClient } = await import("@/lib/supabase/client");
        supabase = createClient();
      } catch {
        setFailed(true);
        return;
      }
      // scope "local": sign out THIS browser only — the default "global"
      // would revoke the user's sessions on every device. Check the result:
      // on a network error auth-js returns {error} WITHOUT clearing the
      // local session, so navigating away would silently leave the user
      // logged in (bad on a shared computer).
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        setFailed(true);
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      // 34,9×20 măsurat pe ambele bare de navigare (client + curier); `py-1` îl
      // aduce la 28 de pixeli, ca pe linkurile de lângă el.
      className="py-1 text-sm text-white/50 transition hover:text-white disabled:opacity-50"
      title={failed ? "Ieșirea a eșuat — verifică conexiunea și încearcă din nou" : undefined}
    >
      {pending ? "..." : failed ? "Reîncearcă ieșirea" : "Ieșire"}
    </button>
  );
}
