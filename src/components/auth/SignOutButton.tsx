"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function handleSignOut() {
    setFailed(false);
    startTransition(async () => {
      const supabase = createClient();
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
      className="text-sm text-white/50 transition hover:text-white disabled:opacity-50"
      title={failed ? "Ieșirea a eșuat — verifică conexiunea și încearcă din nou" : undefined}
    >
      {pending ? "..." : failed ? "Reîncearcă ieșirea" : "Ieșire"}
    </button>
  );
}
