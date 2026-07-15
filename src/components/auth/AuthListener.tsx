"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Cross-tab session sync: sign-out (or sign-in) in one tab refreshes the
// server-rendered UI in every other open tab, so no tab keeps showing a
// personalized header for a session that no longer exists.
export function AuthListener() {
  const router = useRouter();
  // auth-js re-emits SIGNED_IN on every tab refocus — only refresh when the
  // signed-in identity actually changes, otherwise every alt-tab reloads RSC.
  const lastUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_OUT" && event !== "SIGNED_IN") return;
      const userId = session?.user?.id ?? null;
      if (lastUserId.current === userId) return;
      const isFirst = lastUserId.current === undefined;
      lastUserId.current = userId;
      if (!isFirst) router.refresh();
    });
    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
