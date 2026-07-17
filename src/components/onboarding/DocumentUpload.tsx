"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addKycDocument } from "@/app/(customer)/devino-partener/actions";

type Status = "idle" | "uploading" | "done" | "error";

// Uploads a single KYC document to the PRIVATE `kyc-documents` bucket. The path
// MUST start with the user's id — storage RLS enforces foldername[1]=auth.uid().
// After the upload succeeds it records the path via the add_kyc_document RPC.
export function DocumentUpload({
  applicationId,
  docType,
  label,
}: {
  applicationId: string;
  docType: string;
  label: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setStatus("uploading");

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setStatus("error");
        setError("Trebuie să fii autentificat.");
        return;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `${user.id}/${applicationId}-${docType}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("kyc-documents")
        .upload(path, file, { upsert: true });
      if (uploadError) {
        setStatus("error");
        setError(uploadError.message);
        return;
      }

      const result = await addKycDocument(applicationId, docType, path);
      if (result.error) {
        setStatus("error");
        setError(result.error);
        return;
      }

      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Încărcarea a eșuat.");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
        <p className="text-sm text-white/70">{label}</p>
        <p className="mt-1 text-sm font-medium text-emerald-400">Document încărcat ✓</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
      <p className="mb-2 text-sm font-medium text-white">{label}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        aria-label={label}
        disabled={status === "uploading"}
        onChange={handleFile}
        className="block w-full text-sm text-white/70 file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-primary-dark disabled:opacity-50"
      />
      {status === "uploading" && <p className="mt-2 text-xs text-white/50">Se încarcă...</p>}
      {status === "error" && error && <p className="mt-2 text-xs text-primary">{error}</p>}
    </div>
  );
}
