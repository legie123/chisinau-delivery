import { createClient } from "@/lib/supabase/server";

// Shared authorization guards for Server Actions — extracted from four
// near-identical copies (menu/hours/orders/platform actions). These THROW;
// callers convert to { error } for useActionState where needed. RLS remains
// the real boundary — these fail fast with friendly RO messages.

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Neautentificat.");
  return { supabase, user };
}

export async function requireOwnRestaurant() {
  const { supabase, user } = await requireUser();

  // A partner can be staffed at 2+ restaurants — .maybeSingle() THROWS on more
  // than one row (PGRST116). Pick the primary (oldest) link deterministically so
  // the page never 500s. A per-restaurant switcher can layer on later.
  const { data: staffRows } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const staffRow = staffRows?.[0];
  if (!staffRow) throw new Error("Contul tău nu este asociat cu un restaurant.");

  return { supabase, restaurantId: staffRow.restaurant_id as string };
}

export async function requirePlatformAdmin() {
  const { supabase, user } = await requireUser();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "platform_admin") throw new Error("Acces interzis.");

  return { supabase, user };
}
