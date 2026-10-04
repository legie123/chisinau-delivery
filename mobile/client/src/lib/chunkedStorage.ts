// Supabase session storage over the OS keychain/keystore (expo-secure-store).
// SecureStore values above ~2KB can be rejected on Android, and a Supabase session
// (two JWTs + user JSON) is routinely larger — so the value is split in chunks:
// `<key>.n` holds the chunk count, `<key>.0..n-1` the parts. Store injected for tests.

export type SecureKV = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export const CHUNK_SIZE = 1800;

// SecureStore keys allow only [A-Za-z0-9._-].
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export function createChunkedStorage(store: SecureKV) {
  async function removeItem(key: string): Promise<void> {
    const k = safe(key);
    const n = parseInt((await store.getItemAsync(`${k}.n`)) ?? "0", 10) || 0;
    for (let i = 0; i < n; i++) await store.deleteItemAsync(`${k}.${i}`);
    await store.deleteItemAsync(`${k}.n`);
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const k = safe(key);
      const n = parseInt((await store.getItemAsync(`${k}.n`)) ?? "", 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await store.getItemAsync(`${k}.${i}`);
        if (part == null) return null; // torn write — treat as signed out, never as a corrupt session
        parts.push(part);
      }
      return parts.join("");
    },
    async setItem(key: string, value: string): Promise<void> {
      await removeItem(key);
      const k = safe(key);
      const n = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
      for (let i = 0; i < n; i++) await store.setItemAsync(`${k}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      await store.setItemAsync(`${k}.n`, String(n)); // count last: a crash mid-write reads as "no session"
    },
    removeItem,
  };
}
