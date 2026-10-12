// A Server Action call with the network down rejects (TypeError: Failed to fetch). Uncaught,
// it reaches the route error boundary, which unmounts the whole queue — alarm, polling and
// reconnect handling included — while the order's accept clock keeps running (verifier F1,
// 2026-10-12). Every tablet button goes through this so a failed send is just a message.
export const OFFLINE_MESSAGE = "Fără internet — nu s-a trimis. Reîncearcă când revine semnalul.";

export async function offlineSafe<T extends { error: string | null }>(call: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await call();
  } catch {
    return { error: OFFLINE_MESSAGE };
  }
}
