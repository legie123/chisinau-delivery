import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@chisinau/shared-types";

// Typed with the generated Database schema so every .from()/.rpc() call is
// schema-checked at build time — a renamed column, RPC arg, or status enum breaks
// typecheck instead of drifting silently (Master Council Phase 1).
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
