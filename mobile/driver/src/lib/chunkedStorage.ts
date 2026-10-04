// Supabase auth storage over the device keychain/keystore (expo-secure-store).
// SecureStore warns above ~2048 bytes per value and a Supabase session (access
// + refresh token + user JSON) is routinely bigger, so values are split into
// chunks: `<key>` holds the chunk count, `<key>.<i>` the pieces. Pure — the
// store is injected, so this is unit-tested in node with a Map.

export type SecureStoreLike = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export const CHUNK_SIZE = 1800; // chars; stays under the 2048-byte limit even with multi-byte UTF-8 headroom for JWTs (ASCII)

const COUNT_PREFIX = "chunks:";

export function createChunkedStorage(store: SecureStoreLike) {
  async function removeItem(key: string): Promise<void> {
    const head = await store.getItemAsync(key);
    if (head?.startsWith(COUNT_PREFIX)) {
      const n = parseInt(head.slice(COUNT_PREFIX.length), 10) || 0;
      for (let i = 0; i < n; i++) await store.deleteItemAsync(`${key}.${i}`);
    }
    await store.deleteItemAsync(key);
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const head = await store.getItemAsync(key);
      if (head == null || !head.startsWith(COUNT_PREFIX)) return head;
      const n = parseInt(head.slice(COUNT_PREFIX.length), 10) || 0;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await store.getItemAsync(`${key}.${i}`);
        if (part == null) return null; // torn write — treat as signed out, never as a corrupt session
        parts.push(part);
      }
      return parts.join("");
    },

    async setItem(key: string, value: string): Promise<void> {
      await removeItem(key); // a shorter session must not leave stale tail chunks behind
      if (value.length <= CHUNK_SIZE) {
        await store.setItemAsync(key, value);
        return;
      }
      const n = Math.ceil(value.length / CHUNK_SIZE);
      for (let i = 0; i < n; i++) {
        await store.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      }
      await store.setItemAsync(key, `${COUNT_PREFIX}${n}`); // head last: a crash mid-write reads as "no session"
    },

    removeItem,
  };
}
