import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AdminRoleForm, InviteAdminForm } from "./AdminRoleForm";

// The admin team: who holds platform_admin, and the one way to change it (admin_set_platform_admin,
// reason mandatory, audited). Couriers and partners get their roles through onboarding.

export default async function PlatformTeamPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name, created_at").eq("role", "platform_admin").order("created_at");
  const admins = data ?? [];
  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Echipa de administrare</h1>
        <p className="text-sm text-white/50">
          Cine are drept de administrator. Fiecare schimbare apare, cu motivul ei, în{" "}
          <Link href="/platform/audit?table=profiles" className="text-primary underline underline-offset-4">Audit</Link>.
        </p>
      </div>
      {error ? (
        <p className="rounded-xl bg-primary/10 p-4 text-sm text-primary">Lista nu a putut fi citită. Încearcă din nou.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {admins.map((a) => (
            <li key={a.id} className="rounded-2xl bg-white/[0.04] px-5 py-3 text-sm ring-1 ring-white/[0.06]">
              <span className="font-medium text-white">{a.full_name ?? "Fără nume"}</span>
              <span className="ml-2 text-white/40">{a.id.slice(0, 8)}</span>
            </li>
          ))}
        </ul>
      )}
      <InviteAdminForm />
      <AdminRoleForm />
    </main>
  );
}
