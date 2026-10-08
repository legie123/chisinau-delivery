import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";

// "Nu acum" on the in-app explanation shown before the OS location prompt is remembered,
// so Home doesn't nag on every launch. The OS prompt itself is only ever asked once anyway.
const PRIMING_KEY = "location-priming-dismissed";
export async function primingDismissed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRIMING_KEY)) === "1";
  } catch {
    return false;
  }
}
export function dismissPriming(): void {
  AsyncStorage.setItem(PRIMING_KEY, "1").catch(() => {});
}

/** Permission state WITHOUT triggering the OS prompt — lets a screen explain why first. */
export async function locationPermission(): Promise<"granted" | "denied" | "undetermined"> {
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === "granted") return "granted";
    return status === "undetermined" && canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

// Foreground-only, fail-open position: used to sort restaurants by distance and to
// pin a new delivery address. Denied / unavailable / slow -> null, nothing breaks.
// `ask: false` never shows the OS prompt (returns null unless already granted).
export async function currentPosition(timeoutMs = 6000, ask = true): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = ask
      ? await Location.requestForegroundPermissionsAsync()
      : await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!pos) return null;
    return { lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) };
  } catch {
    return null;
  }
}
