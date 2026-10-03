// Web binding of the offline courier status queue. The logic moved to
// @chisinau/shared-domain (packages/shared-domain/src/statusQueue.ts) with the
// storage injected; here it is bound to the browser's localStorage. The API is
// async now (the native app's store is async), callers await it.
import {
  createStatusQueue,
  isNetworkError as isNetworkShapedError,
  type KeyValueStorage,
} from "@chisinau/shared-domain";

export type { AdvanceFn, PendingStatusChange } from "@chisinau/shared-domain";

// `localStorage` (not `window.localStorage`) so a stubbed global works in tests;
// checked per call because `typeof` never throws and SSR has no such global.
const browserStorage: KeyValueStorage = {
  getItem: (k) => (typeof localStorage === "undefined" ? null : localStorage.getItem(k)),
  setItem: (k, v) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(k, v);
  },
  removeItem: (k) => {
    if (typeof localStorage !== "undefined") localStorage.removeItem(k);
  },
};

const queue = createStatusQueue(browserStorage);

export const readPendingQueue = queue.read;
export const enqueueStatusChange = queue.enqueue;
export const hasPendingChange = queue.hasPending;
export const pendingQueueCount = queue.count;
export const giveUpCount = queue.giveUpCount;
export const clearGiveUpCount = queue.clearGiveUpCount;
export const drainPendingQueue = queue.drain;

// Browser offline flag first, then the platform-free error-shape check.
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return true;
  return isNetworkShapedError(err);
}
