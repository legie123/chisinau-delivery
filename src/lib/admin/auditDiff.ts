// One readable line per key of an admin_audit_log row. A side that does not exist (old of an
// INSERT, new of a DELETE) is null; a value that is null inside an existing side shows as "—".
// Masked values ("***") pass through untouched: the log never held the real data.
export type AuditDiffLine = { key: string; from: string | null; to: string | null };

type Values = Record<string, unknown> | null;

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export function auditDiff(_action: string, oldValues: Values, newValues: Values): AuditDiffLine[] {
  const keys = [...new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})])].sort();
  return keys.map((key) => ({
    key,
    from: oldValues ? show(oldValues[key]) : null,
    to: newValues ? show(newValues[key]) : null,
  }));
}
