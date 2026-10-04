import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Background courier GPS. The OS wakes this task with batched locations even
// when the app is backgrounded or the screen is off (Android: foreground-service
// notification "Livrare în curs"; iOS: UIBackgroundModes=location). It keeps the
// web's contract (CLAUDE.md "Realtime"):
//   - PRIVATE broadcast channel order:{id}:location, event "location", ~10s;
//   - low-frequency (45s) upsert into courier_locations for late joiners.
// The task must be defined at module top level, before the app registers — see
// index.ts, which imports this module first.

export const LOCATION_TASK = "dragons-courier-location";
const TRACKING_KEY = "dragons-courier-tracking"; // { orderId, courierId } of the delivery being tracked
const UPSERT_INTERVAL_MS = 45_000;

type Tracking = { orderId: string; courierId: string };

let lastUpsertAt = 0;
let live: { orderId: string; channel: RealtimeChannel } | null = null;

function channelFor(orderId: string): RealtimeChannel {
  if (live?.orderId === orderId) return live.channel;
  if (live) void supabase.removeChannel(live.channel);
  const channel = supabase.channel(`order:${orderId}:location`, { config: { private: true } });
  void supabase.realtime.setAuth();
  channel.subscribe();
  live = { orderId, channel };
  return channel;
}

async function readTracking(): Promise<Tracking | null> {
  const raw = await AsyncStorage.getItem(TRACKING_KEY);
  return raw ? (JSON.parse(raw) as Tracking) : null;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[courier-gps] task error", error.message);
    return;
  }
  const loc = data?.locations?.[data.locations.length - 1];
  if (!loc) return;
  const tracking = await readTracking();
  if (!tracking) return;

  const point = { lat: loc.coords.latitude, lng: loc.coords.longitude };
  void channelFor(tracking.orderId).send({ type: "broadcast", event: "location", payload: point });

  const now = Date.now();
  if (now - lastUpsertAt > UPSERT_INTERVAL_MS) {
    lastUpsertAt = now;
    const { error: upsertError } = await supabase
      .from("courier_locations")
      .upsert({ courier_id: tracking.courierId, lat: point.lat, lng: point.lng, accuracy_m: loc.coords.accuracy ?? null });
    if (upsertError) {
      lastUpsertAt = 0; // retry on the next fix instead of going stale for 45s
      console.warn("[courier-gps] last-known upsert failed", upsertError.message);
    }
  }
});

/**
 * Starts (or retargets) background tracking for an accepted delivery. Returns a
 * Romanian warning when tracking is degraded (no "Always" permission) or null.
 */
export async function startDeliveryTracking(orderId: string, courierId: string): Promise<string | null> {
  await AsyncStorage.setItem(TRACKING_KEY, JSON.stringify({ orderId, courierId } satisfies Tracking));

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    return "Permisiunea de localizare a fost refuzată — clientul nu îți vede poziția live.";
  }
  const bg = await Location.requestBackgroundPermissionsAsync();

  if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 10_000,
      distanceInterval: 25,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.OtherNavigation,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Livrare în curs",
        notificationBody: "Locația ta se transmite clientului cât timp livrezi.",
        notificationColor: "#E94560",
        killServiceOnDestroy: false,
      },
    });
  }

  return bg.status === "granted"
    ? null
    : "Fără permisiunea „Întotdeauna”, poziția se transmite doar cu aplicația deschisă. Activeaz-o din Setări → Localizare.";
}

/** Stops tracking — on delivered, cancelled, going offline, or sign-out. Safe to call repeatedly. */
export async function stopDeliveryTracking(): Promise<void> {
  await AsyncStorage.removeItem(TRACKING_KEY);
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  if (live) {
    void supabase.removeChannel(live.channel);
    live = null;
  }
}

export async function trackedOrderId(): Promise<string | null> {
  return (await readTracking())?.orderId ?? null;
}
