import { useEffect, useState } from "react";
import * as Location from "expo-location";

export interface DevicePosition {
  lat: number;
  lng: number;
}

// Watches the device's real GPS position purely for map display (the courier's
// own marker on MapScreen). Independent of useBroadcastCourierLocation, which
// additionally pushes the position to the backend during an active delivery —
// this hook never writes anywhere, so it's safe to run any time the map is on
// screen, not only mid-delivery.
export function useDevicePosition() {
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== "granted") {
        setError("Permisiunea de localizare a fost refuzată — poziția ta pe hartă nu este live.");
        return;
      }
      setError(null);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5_000, distanceInterval: 15 },
        (loc) => setPosition({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
      );
    })().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Eroare la accesarea GPS-ului.");
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return { position, error };
}
