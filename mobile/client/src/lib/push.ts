import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
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

let registeredToken: string | null = null;

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

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return "no-eas-project-id"; // run `eas init` once — see mobile/README.md

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { data } = await supabase.auth.getSession();
    if (!data.session) return "signed-out";
    await registerDevicePushToken(supabase, token, Platform.OS === "ios" ? "ios" : "android");
    registeredToken = token;
    return "registered";
  } catch (err) {
    console.warn("[push] registration failed", err);
    return "error";
  }
}

/** Call BEFORE signOut: the token row is deleted while we still own it (RLS). */
export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  await supabase.from("device_push_tokens").delete().eq("expo_token", registeredToken);
  registeredToken = null;
}

/** Order id from a notification's `url` ("/orders/<id>" or "/catering/<id>"). */
export function orderIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = url.match(/^\/(?:orders|catering)\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

export function onNotificationOpened(handler: (orderId: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const id = orderIdFromUrl(response.notification.request.content.data?.url);
    if (id) handler(id);
  });
  return () => sub.remove();
}
