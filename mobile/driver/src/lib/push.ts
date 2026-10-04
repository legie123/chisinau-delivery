import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { registerDevicePushToken } from "@chisinau/shared-api";
import { supabase } from "./supabase";

// Native push = the only way a backgrounded courier learns about a 30s offer
// (timers/sockets don't run reliably in the background). The token goes to
// device_push_tokens via register_device_push_token (RPC-only table); the push
// drain (src/app/api/push/drain/route.ts) sends each outbox row to it via Expo.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Notificări",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  // The drain routes every `offer:` row to this channel (see src/lib/push/expo.ts).
  await Notifications.setNotificationChannelAsync("offers", {
    name: "Oferte de livrare",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 400, 200, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

async function currentToken(): Promise<string | null> {
  const id = projectId();
  if (!id) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
}

/** Registers this device for the signed-in courier. Returns a Romanian warning, or null when push is live. */
export async function registerForPush(): Promise<string | null> {
  try {
    await ensureAndroidChannels();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") {
      return "Notificările sunt oprite — nu vei afla de oferte când aplicația e în fundal.";
    }
    const token = await currentToken();
    if (!token) return "Notificări indisponibile în acest build (lipsește proiectul EAS).";
    await registerDevicePushToken(supabase, token, Platform.OS === "ios" ? "ios" : "android");
    return null;
  } catch (err) {
    console.warn("[push] register failed", err);
    return "Nu am putut activa notificările — ofertele apar doar cu aplicația deschisă.";
  }
}

/** On sign-out: this phone must stop receiving the previous courier's offers. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = await currentToken();
    if (token) await supabase.from("device_push_tokens").delete().eq("expo_token", token);
  } catch (err) {
    console.warn("[push] unregister failed", err);
  }
}
