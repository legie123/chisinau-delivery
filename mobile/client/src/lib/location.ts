import * as Location from "expo-location";

// Foreground-only, fail-open position: used to sort restaurants by distance and to
// pin a new delivery address. Denied / unavailable / slow -> null, nothing breaks.
export async function currentPosition(timeoutMs = 6000): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
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
