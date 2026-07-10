import type { ReactNode } from "react";
import type { UserRole } from "@/lib/types/domain";

// UX-layer gate only — avoids flashing UI the current role shouldn't act on.
// The real security boundary is Postgres RLS (has_role/has_any_role/
// has_restaurant_access), not this component.
export function RoleGate({
  role,
  allow,
  children,
  fallback = null,
}: {
  role: UserRole | null;
  allow: UserRole[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  if (!role || !allow.includes(role)) return fallback;
  return children;
}
