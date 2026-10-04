import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { supabaseConfig } from "./config";
import { createChunkedStorage } from "./chunkedStorage";

const { url, anonKey } = supabaseConfig();

// Session in the keychain/keystore, not AsyncStorage (plain file on disk).
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: createChunkedStorage(SecureStore),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Timers don't run while backgrounded: refresh only in the foreground, and resume
// (which refreshes an expired token at once) as soon as the app is active again.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

export type Db = typeof supabase;
