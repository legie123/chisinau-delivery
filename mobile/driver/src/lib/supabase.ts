import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { createChunkedStorage } from "./chunkedStorage";
import { readSupabaseConfig } from "./config";

// Metro only inlines `process.env.EXPO_PUBLIC_X` written out literally.
const { url, anonKey } = readSupabaseConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

// AFTER_FIRST_UNLOCK: the background GPS task may run while the phone is
// locked; with the default (WHEN_UNLOCKED) iOS refuses the keychain read and the
// task would broadcast without a session (RLS would reject every ping).
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
const secureStore = {
  getItemAsync: (key: string) => SecureStore.getItemAsync(key, KEYCHAIN),
  setItemAsync: (key: string, value: string) => SecureStore.setItemAsync(key, value, KEYCHAIN),
  deleteItemAsync: (key: string) => SecureStore.deleteItemAsync(key, KEYCHAIN),
};

// With no session at hand (token lapsed and the refresh failing, auth-js's 60 s refresh-failure
// cooldown, the keychain mid-rewrite during a refresh) supabase-js sends PostgREST calls with the
// anon key, and RLS answers them with NO ROWS — read here as "reassigned", "not mine", "no active
// delivery", "not a courier" (verifier, 2026-10-04). The courier app has no anon PostgREST call, so
// none leaves the phone: it is answered right here with a network-shaped error ("cannot tell").
// The check reads the header the request actually carries, so no refresh can slip in between.
const NO_COURIER_SESSION = JSON.stringify({ message: "network: no courier session" });
function courierFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (target.includes("/rest/v1/") && new Headers(init?.headers).get("Authorization") === `Bearer ${anonKey}`) {
    return Promise.resolve(new Response(NO_COURIER_SESSION, { status: 401, headers: { "Content-Type": "application/json" } }));
  }
  return fetch(input, init);
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: createChunkedStorage(secureStore),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: courierFetch },
});

// Refresh timers do not run reliably while the app is backgrounded; Supabase's
// RN guidance is to drive auto-refresh from AppState.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
