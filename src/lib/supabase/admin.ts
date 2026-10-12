import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Only import this from Server
// Actions/Route Handlers that have already verified the caller is
// platform_admin. Never expose SUPABASE_SERVICE_ROLE_KEY to the client.
// actorId (mandatory): the verified admin this call acts for, sent as `x-audit-actor`; the
// admin_audit_log trigger attributes the write to them. System jobs (push, webhooks) use
// createSystemClient(): their writes are still audited, as 'system'.
export function createAdminClient(actorId: string) {
  return serviceClient({ "x-audit-actor": actorId });
}

export function createSystemClient() {
  return serviceClient(undefined);
}

function serviceClient(headers: Record<string, string> | undefined) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    // Actionable message — there IS a working path without this key: the applicant
    // self-registers (/devino-partener) and an admin approves the request in
    // Onboarding, which grants the role. The direct invite is a shortcut that needs
    // the service-role key (set SUPABASE_SERVICE_ROLE_KEY in .env.local to enable).
    throw new Error(
      "Invitarea directă e dezactivată (lipsește cheia de service). Onboardează prin auto-înregistrare + aprobare din secțiunea Onboarding, sau activează cheia local.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: headers ? { headers } : undefined,
  });
}
