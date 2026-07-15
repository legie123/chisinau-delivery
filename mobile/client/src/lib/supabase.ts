import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Anon key is public by design (RLS is the security boundary); values can be
// overridden per-environment via EXPO_PUBLIC_* in .env.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://rdowjxnuyawhrjppxzuu.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkb3dqeG51eWF3aHJqcHB4enV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NTE4NzQsImV4cCI6MjA5MjAyNzg3NH0.UMa8W0zFGD73GKh5_a3CHGh6Qh3K6VHMX01h52ugpaI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
