import { describe, expect, it } from "vitest";
import { readSupabaseConfig } from "../src/lib/config";
import { CHUNK_SIZE, createChunkedStorage, type SecureKV } from "../src/lib/chunkedStorage";

describe("backend config — env only, loud when missing", () => {
  it("throws naming every missing variable", () => {
    expect(() => readSupabaseConfig({})).toThrow(/EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY/);
    expect(() => readSupabaseConfig({ url: "https://x.supabase.co", anonKey: " " })).toThrow(/ANON_KEY/);
    expect(() => readSupabaseConfig({ url: "x.supabase.co", anonKey: "k" })).toThrow(/http/);
    expect(readSupabaseConfig({ url: " https://x.supabase.co ", anonKey: "k" })).toEqual({ url: "https://x.supabase.co", anonKey: "k" });
  });
});

describe("session storage — keychain values stay under the size limit", () => {
  function fakeSecureStore(limit = 2048) {
    const map = new Map<string, string>();
    const store: SecureKV = {
      getItemAsync: async (k) => map.get(k) ?? null,
      setItemAsync: async (k, v) => {
        if (v.length > limit) throw new Error("value too large for SecureStore");
        if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error("invalid key");
        map.set(k, v);
      },
      deleteItemAsync: async (k) => void map.delete(k),
    };
    return { store, map };
  }

  it("round-trips a session bigger than one SecureStore value", async () => {
    const { store, map } = fakeSecureStore();
    const s = createChunkedStorage(store);
    const session = JSON.stringify({ access_token: "a".repeat(3000), refresh_token: "r".repeat(1500), user: { id: "u" } });
    await s.setItem("sb-127-auth-token", session);
    expect(await s.getItem("sb-127-auth-token")).toBe(session);
    expect(Math.max(...[...map.values()].map((v) => v.length))).toBeLessThanOrEqual(CHUNK_SIZE);
  });

  it("a shorter rewrite leaves no stale chunks; remove clears everything", async () => {
    const { store, map } = fakeSecureStore();
    const s = createChunkedStorage(store);
    await s.setItem("k", "x".repeat(5000));
    await s.setItem("k", "short");
    expect(await s.getItem("k")).toBe("short");
    expect([...map.keys()].sort()).toEqual(["k.0", "k.n"]);
    await s.removeItem("k");
    expect(map.size).toBe(0);
    expect(await s.getItem("k")).toBeNull();
  });

  it("a torn write (missing chunk) reads as signed-out, never as a corrupt session", async () => {
    const { store, map } = fakeSecureStore();
    const s = createChunkedStorage(store);
    await s.setItem("k", "y".repeat(4000));
    map.delete("k.1");
    expect(await s.getItem("k")).toBeNull();
  });
});
