import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { COLORS } from '../../theme';
import type { LatLng } from '../../lib/realtime';
import type { TrackingRoute } from '../../lib/tracking';

const toCoord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });
const EDGE = { top: 60, right: 50, bottom: 50, left: 50 };

// Pickup + dropoff + live courier, the route line and the ETA chip. The camera
// frames every point once the map is ready, then glides after the courier on each
// GPS tick (~10s broadcast) instead of staying parked on initialRegion.
export function TrackingMap({
  pickup,
  dropoff,
  courier,
  route,
  restaurantName,
}: {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  courier: LatLng | null;
  route: TrackingRoute | null;
  restaurantName?: string;
}) {
  const mapRef = useRef<MapView>(null);
  const points = [pickup, dropoff, courier].filter((p): p is LatLng => p != null);
  const center = courier ?? dropoff ?? points[0];

  function frame() {
    if (points.length > 1) mapRef.current?.fitToCoordinates(points.map(toCoord), { edgePadding: EDGE, animated: true });
  }

  useEffect(() => {
    if (courier) mapRef.current?.animateCamera({ center: toCoord(courier) }, { duration: 800 });
  }, [courier]); // a new object per GPS tick (setCourier), so this fires once per fix

  if (!center) return null;
  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{ ...toCoord(center), latitudeDelta: 0.04, longitudeDelta: 0.04 }}
        onMapReady={frame}
      >
        {route && <Polyline coordinates={route.line.map(toCoord)} strokeColor={COLORS.primary} strokeWidth={4} lineDashPattern={[8, 6]} />}
        {pickup && <Marker coordinate={toCoord(pickup)} title={restaurantName} pinColor={COLORS.gold} />}
        {dropoff && <Marker coordinate={toCoord(dropoff)} title="Adresa ta" pinColor={COLORS.success} />}
        {courier && <Marker coordinate={toCoord(courier)} title="Curierul" pinColor={COLORS.primary} />}
      </MapView>
      {route && (
        <View style={styles.eta} accessibilityLiveRegion="polite">
          <Text style={styles.etaText}>{route.label}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 260, borderRadius: 16, overflow: 'hidden', marginBottom: 8 },
  map: { flex: 1 },
  eta: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: COLORS.glass,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.gold + '60',
  },
  etaText: { color: COLORS.gold, fontWeight: '800', fontSize: 13 },
});
