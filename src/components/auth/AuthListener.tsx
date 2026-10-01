"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Cross-tab session sync: sign-out (or sign-in) in one tab refreshes the
// server-rendered UI in every other open tab, so no tab keeps showing a
// personalized header for a session that no longer exists.
//
// The Supabase client is imported lazily: this component sits in the ROOT
// layout, so a static import put supabase-js (~62 KB gzip) in the initial JS of
// every page, public ones included. Cross-tab sync can start after hydration.
export function AuthListener() {
  const router = useRouter();
  // auth-js re-emits SIGNED_IN on every tab refocus — only refresh when the
  // signed-in identity actually changes, otherwise every alt-tab reloads RSC.
  const lastUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void import("@/lib/supabase/client").then(({ createClient }) => {
      if (cancelled) return;
      const {
        data: { subscription },
      } = createClient().auth.onAuthStateChange((event, session) => {
        if (event !== "SIGNED_OUT" && event !== "SIGNED_IN") return;
        const userId = session?.user?.id ?? null;
        if (lastUserId.current === userId) return;
        const isFirst = lastUserId.current === undefined;
        lastUserId.current = userId;
        if (!isFirst) router.refresh();
      });
      unsubscribe = () => subscription.unsubscribe();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [router]);

  return null;
}
