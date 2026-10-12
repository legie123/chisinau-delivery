"use client";

import { useState, useTransition } from "react";
import { settleExportLine, voidExport } from "@/app/(admin)/platform/payouts/actions";

// Settles ONE line of a frozen export batch: exactly the rows that went to the bank. A line whose IBAN
// changed since the payee's last payment needs the admin to tick "am confirmat" first (the RPC refuses
// otherwise). Replaces the page-bound settle that overpaid when a refund landed after the export.
export function SettleExportLineButton({
  exportId,
  recipientType,
  recipientId,
  netMdl,
  ibanChanged,
}: {
  exportId: string;
  recipientType: "courier" | "restaurant";
  recipientId: string;
  netMdl: number;
  ibanChanged: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      {ibanChanged && (
        <label className="flex items-center gap-1.5 text-[11px] text-red-300">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          IBAN schimbat de la ultima plată — am confirmat cu beneficiarul
        </label>
      )}
      <button
        type="button"
        disabled={pending || (ibanChanged && !confirmed)}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await settleExportLine(exportId, recipientType, recipientId, confirmed);
            if (res.error) setError(res.error);
          });
        }}
        className="rounded-full bg-primary-dark px-3 py-1 text-xs font-semibold text-white transition hover:bg-primary-darker disabled:opacity-40"
      >
        {pending ? "Se salvează..." : `Marchează plătit · ${netMdl.toFixed(2)} MDL`}
      </button>
      {error && <span className="text-[11px] text-primary">{error}</span>}
    </div>
  );
}

export function VoidExportButton({ exportId }: { exportId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await voidExport(exportId);
            if (res.error) setError(res.error);
          });
        }}
        className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40"
      >
        Anulează exportul (n-a fost trimis la bancă)
      </button>
      {error && <span className="text-[11px] text-primary">{error}</span>}
    </span>
  );
}
