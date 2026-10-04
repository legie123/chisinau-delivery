import { PlatformNav } from "@/components/admin/PlatformNav";

// The monolith's (admin)/layout serves /platform AND /restaurant by role; this app
// only has /platform, so it composes the platform branch alone.
export default function MasterAdminLayout({ children }: { children: React.ReactNode }) {
  return <PlatformNav>{children}</PlatformNav>;
}
