// Config comes ONLY from the build environment (EXPO_PUBLIC_* are inlined by
// Metro at bundle time; on EAS set them per build profile). No baked-in
// fallback project: a build without config must fail loudly at startup, never
// silently talk to some other (paused, foreign) Supabase project.
export function readSupabaseConfig(env: Record<string, string | undefined>): { url: string; anonKey: string } {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const missing = [!url && "EXPO_PUBLIC_SUPABASE_URL", !anonKey && "EXPO_PUBLIC_SUPABASE_ANON_KEY"].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Configurare lipsă: ${missing.join(", ")}. Aplicația nu poate porni fără adresa serverului — ` +
        "setează variabilele în .env (local) sau în profilul EAS al build-ului.",
    );
  }
  return { url: url!, anonKey: anonKey! };
}
