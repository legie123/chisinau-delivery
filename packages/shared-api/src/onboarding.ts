import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

// Courier/restaurant onboarding application RPCs.

export type OnboardingInput = {
  type: string;
  fullName: string;
  phone: string;
  email: string;
  details: Json;
};

/** Submit an onboarding application; returns the new application id. */
export async function submitOnboardingApplication(db: Db, input: OnboardingInput): Promise<string> {
  const { data, error } = await db.rpc("submit_onboarding_application", {
    p_type: input.type,
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_email: input.email,
    p_details: input.details,
  });
  if (error) throw new RpcError(error);
  return data as string;
}

/** Attach a KYC document (storage path) to an application. */
export async function addKycDocument(db: Db, applicationId: string, docType: string, storagePath: string): Promise<void> {
  const { error } = await db.rpc("add_kyc_document", {
    p_application_id: applicationId,
    p_doc_type: docType,
    p_storage_path: storagePath,
  });
  if (error) throw new RpcError(error);
}

/** Admin approves/rejects an onboarding application with an optional note. */
export async function reviewOnboardingApplication(db: Db, id: string, approve: boolean, note?: string): Promise<void> {
  const { error } = await db.rpc("review_onboarding_application", { p_id: id, p_approve: approve, p_note: note });
  if (error) throw new RpcError(error);
}
