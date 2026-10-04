import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { statusQueue } from "./offlineQueue";
import { gpsDecision } from "./gpsGate";

// Background courier GPS. The OS wakes this task with batched locations even
// when the app is backgrounded or the screen is off (Android: foreground-service
// notification "Livrare în curs"; iOS: UIBackgroundModes=location). It keeps the
// web's contract (CLAUDE.md "Realtime"):
//   - PRIVATE broadcast channel order:{id}:location, event "location", ~10s;
//   - low-frequency (45s) upsert into courier_locations for late joiners.
// Privacy: the customer's broadcast goes out ONLY while the order is picked_up /
// en_route (the web's window, see ./gpsGate); before pickup only the 45s upsert
// runs, which RLS shows to the restaurant alone. Every tick re-reads the order,
// so the task stops by itself on delivered / cancelled / reassigned — even when
// the UI is dead (Android keeps the service alive after the app is killed).
// The task must be defined at module top level, before the app registers — see
// index.ts, which imports this module first.

export const LOCATION_TASK = "dragons-courier-location";
const TRACKING_KEY = "dragons-courier-tracking"; // { orderId, courierId } of the delivery being tracked
const UPSERT_INTERVAL_MS = 45_000;

type Tracking = { orderId: string; courierId: string };
type LatLng = { lat: number; lng: number };

let lastUpsertAt = 0;
// Last status the server confirmed for the tracked order (kept across a tick
// that cannot reach the server, so a dead zone neither leaks nor kills tracking).
let lastKnown: { orderId: string; status: string | null } | null = null;
// Bumped by every stop: a tick that was awaiting across one must not send.
let stops = 0;

// A send before the channel has joined makes realtime-js fall back to a REST
// broadcast that does not wait for setAuth(); the private channel rejects it and
// the first fix of every (re)start was lost. Same fix as the web
// (src/lib/realtime/courierLocation.ts): keep only the latest point until SUBSCRIBED.
type Live = { orderId: string; channel: RealtimeChannel; joined: boolean; queued: LatLng | null };
let live: Live | null = null;

function sendNow(l: Live, point: LatLng) {
  void l.channel.send({ type: "broadcast", event: "location", payload: point });
}

function broadcasterFor(orderId: string): Live {
  if (live?.orderId === orderId) return live;
  if (live) void supabase.removeChannel(live.channel);
  const channel = supabase.channel(`order:${orderId}:location`, { config: { private: true } });
  const l: Live = { orderId, channel, joined: false, queued: null };
  void supabase.realtime.setAuth();
  channel.subscribe((status) => {
    l.joined = status === "SUBSCRIBED";
    if (l.joined && l.queued) {
      sendNow(l, l.queued);
      l.queued = null;
    }
  });
  live = l;
  return l;
}

function broadcast(orderId: string, point: LatLng) {
  const l = broadcasterFor(orderId);
  if (l.joined) sendNow(l, point);
  else l.queued = point;
}

async function readTracking(): Promise<Tracking | null> {
  const raw = await AsyncStorage.getItem(TRACKING_KEY);
  return raw ? (JSON.parse(raw) as Tracking) : null;
}

// undefined = could not ask the server (offline); null = not this courier's order any more.
async function serverStatus(t: Tracking): Promise<string | null | undefined> {
  try {
    const { data, error } = await supabase.from("orders").select("status, courier_id").eq("id", t.orderId).maybeSingle();
    if (error) return undefined;
    return data && data.courier_id === t.courierId ? data.status : null;
  } catch {
    return undefined;
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[courier-gps] task error", error.message);
    return;
  }
  const loc = data?.locations?.[data.locations.length - 1];
  if (!loc) return;
  const run = stops;
  const tracking = await readTracking();
  if (!tracking) return;

  const queuedTarget = (await statusQueue.read()).find((e) => e.orderId === tracking.orderId)?.newStatus ?? null;
  const fresh = await serverStatus(tracking);
  if (run !== stops) return; // delivered / cancelled while this fix was in flight
  if (fresh !== undefined) lastKnown = { orderId: tracking.orderId, status: fresh };
  const known = lastKnown?.orderId === tracking.orderId ? lastKnown.status : undefined;

  const decision = gpsDecision(known, queuedTarget);
  if (decision === "stop") {
    await stopDeliveryTracking().catch((err: unknown) => console.warn("[courier-gps] self-stop failed", err));
    return;
  }
  if (decision === "hold") return;

  const point = { lat: loc.coords.latitude, lng: loc.coords.longitude };
  if (decision === "send") broadcast(tracking.orderId, point);

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
 * Starts (or retargets) background tracking for the active delivery, from accept
 * (./gpsGate decides what each fix feeds). Returns a Romanian warning when
 * tracking is degraded (no "Always" permission) or null.
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
        notificationBody: "Locația ta se transmite restaurantului până la ridicare, apoi clientului.",
        notificationColor: "#E94560",
        killServiceOnDestroy: false,
      },
    });
  }

  return bg.status === "granted"
    ? null
    : "Fără permisiunea „Întotdeauna”, poziția se transmite doar cu aplicația deschisă. Activeaz-o din Setări → Localizare.";
}

/**
 * Android refuses to start the foreground service while the app is in the
 * background (expo-location throws), and nothing retried it: no GPS for the
 * whole delivery. Call on AppState 'active' — re-arms a recorded delivery whose
 * updates are not running. Returns a warning, or null.
 */
export async function resumeDeliveryTracking(): Promise<string | null> {
  const t = await readTracking();
  if (!t || (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) return null;
  return startDeliveryTracking(t.orderId, t.courierId);
}

/** Stops tracking — on delivered, cancelled, going offline, or sign-out. Safe to call repeatedly. Throws if the OS refused to stop. */
export async function stopDeliveryTracking(): Promise<void> {
  stops++;
  await AsyncStorage.removeItem(TRACKING_KEY);
  if (live) {
    void supabase.removeChannel(live.channel);
    live = null;
  }
  lastKnown = null;
  lastUpsertAt = 0; // the next delivery's first fix replaces this one's last row at once
  let started = true; // unknown → try to stop anyway instead of silently leaving GPS on
  try {
    started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch (err) {
    console.warn("[courier-gps] hasStarted check failed", err);
  }
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

export async function trackedOrderId(): Promise<string | null> {
  return (await readTracking())?.orderId ?? null;
}
