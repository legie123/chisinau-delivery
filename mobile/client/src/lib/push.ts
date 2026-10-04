import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { registerDevicePushToken } from "@chisinau/shared-api";
import { supabase } from "./supabase";

// Native push: the Expo token goes to device_push_tokens via register_device_push_token
// (shared-api). The notification outbox the web already fills (order accepted, courier
// on the way, catering quote...) is what the push drain sends to these tokens.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// The registered token survives app restarts: sign-out must unbind it even in a run
// where registration failed or was skipped (memory alone forgot it).
const TOKEN_KEY = "push-expo-token";
let registeredToken: string | null = null;

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Best-effort: never blocks the UI, never throws. Returns why it skipped, for logs. */
export async function registerForPush(): Promise<string> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Comenzi",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return "permission-denied";

    const id = projectId();
    if (!id) return "no-eas-project-id"; // run `eas init` once — see mobile/README.md

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const { data } = await supabase.auth.getSession();
    if (!data.session) return "signed-out";
    await bind(token);
    return "registered";
  } catch (err) {
    console.warn("[push] registration failed", err);
    return "error";
  }
}

async function bind(token: string): Promise<void> {
  await registerDevicePushToken(supabase, token, Platform.OS === "ios" ? "ios" : "android");
  registeredToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => undefined);
}

// This device's token: this run's, the one persisted by an earlier run, or — when
// neither is known (older build, failed write) — the device's current Expo token.
async function deviceToken(): Promise<string | null> {
  if (registeredToken) return registeredToken;
  const stored = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (stored) return stored;
  // That last read is best-effort: it fails for good on a build without FCM, in Expo Go on
  // Android and on phones without Google services, and a token the phone can't produce was
  // never bound — throwing there would make sign-out impossible.
  try {
    const { status } = await Notifications.getPermissionsAsync();
    const id = projectId();
    if (status !== "granted" || !id) return null; // never had a token to bind
    return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch {
    return null;
  }
}

/** Call BEFORE signOut: the token row is deleted while we still own it (RLS).
 *  Throws if it could not be deleted — the caller must not sign out then.
 *  Returns the token it unbound (null: this phone never had one). */
export async function unregisterPush(): Promise<string | null> {
  const token = await deviceToken();
  if (!token) return null;
  const { error } = await supabase.from("device_push_tokens").delete().eq("expo_token", token);
  if (error) throw new Error(error.message);
  registeredToken = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  return token;
}

export const UNBIND_FAILED = "Nu am putut opri notificările pe acest telefon — verifică conexiunea și încearcă din nou.";
export const SIGN_OUT_FAILED = "Nu am putut încheia sesiunea — verifică conexiunea și încearcă din nou.";
export const SIGN_OUT_FAILED_PUSH_OFF =
  "Nu am putut încheia sesiunea, iar notificările sunt oprite pe acest telefon până repornești aplicația — verifică conexiunea și încearcă din nou.";

/** The only sign-out path: a signed-out phone must never stay bound to the user
 *  (the drain would keep sending their order notifications to it). On failure the
 *  session is kept and the error (Romanian) is thrown for a retry.
 *  ponytail: a session lost any other way (expiry, revoked refresh token) can't delete its
 *  row any more (RLS, expired JWT); the drain must skip tokens whose session is gone. */
export async function signOutAndUnbindPush(): Promise<void> {
  let token: string | null;
  try {
    token = await unregisterPush();
  } catch {
    throw new Error(UNBIND_FAILED);
  }
  // Local, like every other sign-out in the repo: the default ("global") also ends this
  // user's sessions on their other phones, which then sit signed out but still bound.
  // A logout request that can't reach the server resolves { error } and KEEPS the session.
  let error: unknown;
  try {
    ({ error } = await supabase.auth.signOut({ scope: "local" }));
  } catch {
    // A THROW comes after the server call, from clearing the local session (e.g. an Android
    // keystore error): never show that raw English text, and do not re-bind a revoked session.
    throw new Error(SIGN_OUT_FAILED);
  }
  if (!error) return;
  // Still signed in, but this phone's row is already gone: bind it back, or say push is off.
  const rebound = !token || (await bind(token).then(() => true, () => false));
  throw new Error(rebound ? SIGN_OUT_FAILED : SIGN_OUT_FAILED_PUSH_OFF);
}

// ---- notification taps ----

export type PushTarget = { name: "OrderTracking"; params: { orderId: string } } | { name: "Concierge"; params?: undefined };

/** Screen for a notification's `url` ("/orders/<id>", "/catering/<id>", "/concierge/..."). */
export function pushTarget(url: unknown): PushTarget | null {
  if (typeof url !== "string") return null;
  const m = url.match(/^\/(?:orders|catering)\/([0-9a-f-]{36})/i);
  if (m) return { name: "OrderTracking", params: { orderId: m[1] } };
  if (url.startsWith("/concierge")) return { name: "Concierge" };
  return null;
}

/** Opens a target now, or keeps it until the navigator is ready (cold start). */
export function createPushOpener(nav: { isReady(): boolean; navigate(name: string, params?: object): void }) {
  let pending: PushTarget | null = null;
  const go = (t: PushTarget) => nav.navigate(t.name, t.params);
  return {
    open(t: PushTarget) {
      if (nav.isReady()) go(t);
      else pending = t;
    },
    /** NavigationContainer onReady. */
    flush() {
      if (!pending || !nav.isReady()) return;
      const t = pending;
      pending = null;
      go(t);
    },
  };
}

export function onNotificationOpened(handler: (target: PushTarget) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const t = pushTarget(response.notification.request.content.data?.url);
    if (t) handler(t);
  });
  return () => sub.remove();
}
