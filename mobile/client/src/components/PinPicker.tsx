import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { currentPosition } from '../lib/location';
import { CHISINAU_CENTER } from '../lib/checkout';

type Pin = { lat: number; lng: number };
const ZOOM = { latitudeDelta: 0.006, longitudeDelta: 0.006 };

// The delivery pin (C1): place_order refuses an address without one, and the courier navigates to
// it. Tap the map or drag the pin to the door; "Locația mea" jumps to GPS. Opens on the saved pin,
// else on central Chișinău at city zoom.
export default function PinPicker({ value, onChange }: { value: Pin | null; onChange: (p: Pin) => void }) {
  const map = useRef<MapView>(null);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState(false);
  const start = value ?? CHISINAU_CENTER;

  function place(p: Pin) {
    onChange(p);
    map.current?.animateToRegion({ latitude: p.lat, longitude: p.lng, ...ZOOM }, 400);
  }

  async function useMyLocation() {
    setLocating(true);
    setGpsError(false);
    const p = await currentPosition();
    setLocating(false);
    if (p) place(p);
    else setGpsError(true);
  }

  return (
    <View>
      <View style={styles.mapBox}>
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          initialRegion={{ latitude: start.lat, longitude: start.lng, ...(value ? ZOOM : { latitudeDelta: 0.08, longitudeDelta: 0.08 }) }}
          onPress={e => onChange({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
          accessibilityLabel="Harta pentru pinul de livrare"
        >
          {value && (
            <Marker
              draggable
              coordinate={{ latitude: value.lat, longitude: value.lng }}
              onDragEnd={e => onChange({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
              pinColor={COLORS.primary}
            />
          )}
        </MapView>
      </View>
      <View style={styles.row}>
        <Text style={[styles.hint, !value && styles.hintTodo]}>
          {value ? 'Pin fixat ✓ — trage-l exact la intrare' : 'Atinge harta unde e intrarea'}
        </Text>
        <TouchableOpacity style={styles.gpsBtn} onPress={useMyLocation} disabled={locating} accessibilityLabel="Folosește locația mea">
          {locating ? <ActivityIndicator size="small" color={COLORS.gold} /> : <Ionicons name="locate" size={16} color={COLORS.gold} />}
          <Text style={styles.gpsText}>Locația mea</Text>
        </TouchableOpacity>
      </View>
      {gpsError && <Text style={styles.error}>Nu am putut obține locația — fixează pinul atingând harta.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  mapBox: { height: 220, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 },
  hint: { flex: 1, fontSize: 13, color: COLORS.textMuted },
  hintTodo: { color: COLORS.gold, fontWeight: '600' },
  gpsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, minHeight: 44 },
  gpsText: { fontSize: 13, color: COLORS.gold, fontWeight: '600' },
  error: { marginTop: 6, fontSize: 12, color: COLORS.primary },
});
