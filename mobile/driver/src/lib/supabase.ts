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

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: createChunkedStorage(secureStore),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh timers do not run reliably while the app is backgrounded; Supabase's
// RN guidance is to drive auto-refresh from AppState.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
