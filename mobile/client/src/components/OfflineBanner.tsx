import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { COLORS } from "../theme";
import { trackConnectivity } from "../lib/connectivity";

/** True while the device is offline. `onReconnect` runs on every offline -> online edge
 *  (the latest one passed is used, so it may close over fresh state). */
export function useOffline(onReconnect?: () => void): boolean {
  const [offline, setOffline] = useState(false);
  const reconnect = useRef(onReconnect);
  reconnect.current = onReconnect;
  useEffect(
    () =>
      NetInfo.addEventListener(
        trackConnectivity((off) => {
          setOffline(off);
          if (!off) reconnect.current?.();
        }),
      ),
    [],
  );
  return offline;
}

/** Global strip over every screen while offline. Touches pass through it. */
export default function OfflineBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <SafeAreaView edges={["top"]} style={styles.wrap} pointerEvents="none">
      <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Ionicons name="cloud-offline-outline" size={14} color={COLORS.white} />
        <Text style={styles.text}>Fără conexiune la internet</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 1000, elevation: 1000 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "center",
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.primaryDark,
  },
  text: { color: COLORS.white, fontSize: 12, fontWeight: "700" },
});
