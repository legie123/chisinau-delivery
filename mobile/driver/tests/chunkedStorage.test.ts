import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, createChunkedStorage, type SecureStoreLike } from "../src/lib/chunkedStorage";
import { readSupabaseConfig } from "../src/lib/config";

function memoryStore() {
  const map = new Map<string, string>();
  const store: SecureStoreLike = {
    getItemAsync: async (k) => map.get(k) ?? null,
    setItemAsync: async (k, v) => {
      if (v.length > 2048) throw new Error(`value too large for SecureStore (${v.length})`);
      map.set(k, v);
    },
    deleteItemAsync: async (k) => {
      map.delete(k);
    },
  };
  return { map, store };
}

const KEY = "sb-127-auth-token";

describe("chunked SecureStore session storage", () => {
  it("round-trips a session bigger than SecureStore's 2KB limit", async () => {
    const { store, map } = memoryStore();
    const s = createChunkedStorage(store);
    const session = JSON.stringify({ access_token: "a".repeat(3000), refresh_token: "r".repeat(400), user: { id: "u" } });
    await s.setItem(KEY, session);
    expect(await s.getItem(KEY)).toBe(session);
    for (const v of map.values()) expect(v.length).toBeLessThanOrEqual(CHUNK_SIZE);
  });

  it("a shorter session replaces a longer one without stale tail chunks", async () => {
    const { store, map } = memoryStore();
    const s = createChunkedStorage(store);
    await s.setItem(KEY, "x".repeat(CHUNK_SIZE * 3 + 5));
    await s.setItem(KEY, "small");
    expect(await s.getItem(KEY)).toBe("small");
    expect([...map.keys()]).toEqual([KEY]);
  });

  it("removeItem deletes every chunk (sign-out leaves nothing in the keychain)", async () => {
    const { store, map } = memoryStore();
    const s = createChunkedStorage(store);
    await s.setItem(KEY, "y".repeat(CHUNK_SIZE * 2 + 1));
    await s.removeItem(KEY);
    expect(map.size).toBe(0);
    expect(await s.getItem(KEY)).toBeNull();
  });

  it("a torn write (missing chunk) reads as signed-out, not as a corrupt session", async () => {
    const { store, map } = memoryStore();
    const s = createChunkedStorage(store);
    await s.setItem(KEY, "z".repeat(CHUNK_SIZE * 2 + 1));
    map.delete(`${KEY}.1`);
    expect(await s.getItem(KEY)).toBeNull();
  });
});

describe("Supabase config", () => {
  it("refuses to start without EXPO_PUBLIC_* — Romanian error naming the missing vars", () => {
    expect(() => readSupabaseConfig({})).toThrow(/Configurare lipsă: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY/);
    expect(() => readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co", EXPO_PUBLIC_SUPABASE_ANON_KEY: "  " })).toThrow(
      /EXPO_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  it("returns the configured values (no baked-in fallback project)", () => {
    expect(readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co", EXPO_PUBLIC_SUPABASE_ANON_KEY: "k" })).toEqual({
      url: "https://x.supabase.co",
      anonKey: "k",
    });
  });
});
