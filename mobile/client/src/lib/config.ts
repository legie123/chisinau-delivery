// Build-time config. Expo inlines ONLY literal `process.env.EXPO_PUBLIC_*` member
// reads, so the two reads stay literal here. No fallback project: a build without
// its env must die at launch, loudly — never talk silently to some other backend.

export type SupabaseConfig = { url: string; anonKey: string };

export function readSupabaseConfig(env: { url?: string; anonKey?: string }): SupabaseConfig {
  const missing = [
    !env.url?.trim() && "EXPO_PUBLIC_SUPABASE_URL",
    !env.anonKey?.trim() && "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Configurație lipsă: ${missing.join(", ")} (setează-le în .env sau în EAS env).`);
  }
  if (!/^https?:\/\//.test(env.url!.trim())) {
    throw new Error("Configurație invalidă: EXPO_PUBLIC_SUPABASE_URL trebuie să înceapă cu http:// sau https://.");
  }
  return { url: env.url!.trim(), anonKey: env.anonKey!.trim() };
}

export const supabaseConfig = (): SupabaseConfig =>
  readSupabaseConfig({
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  });
