import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

/** Grant (true) or revoke (false) platform_admin by email; reason mandatory, stored in the audit log. */
export async function setPlatformAdmin(db: Db, email: string, grant: boolean, reason: string): Promise<void> {
  const { error } = await db.rpc("admin_set_platform_admin", { p_email: email, p_grant: grant, p_reason: reason });
  if (error) throw new RpcError(error);
}
