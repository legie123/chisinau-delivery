import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import MapScreen from './src/screens/MapScreen';
import OrdersHistoryScreen from './src/screens/OrdersHistoryScreen';
import EarningsScreen from './src/screens/EarningsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ActiveDeliveryScreen from './src/screens/ActiveDeliveryScreen';
import LoginScreen from './src/screens/LoginScreen';
import { supabase } from './src/lib/supabase';
import { onOfferTapped, registerForPush } from './src/lib/push';
import { hasActiveDelivery, restoreCourierSession } from './src/lib/api';
import { stopDeliveryTracking } from './src/lib/backgroundLocation';
import { useOfflineSync } from './src/hooks/useOfflineSync';

const navRef = createNavigationContainerRef<any>();

const COLORS = {
  surface: '#1A1A2E',
  border: 'rgba(255,255,255,0.08)',
  primary: '#E94560',
  textMuted: 'rgba(255,255,255,0.4)',
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 25,
          paddingTop: 10,
        },
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        tabBarIcon: ({ focused, color }) => {
          let iconName: any;
          if (route.name === 'Map') iconName = focused ? 'map' : 'map-outline';
          else if (route.name === 'Orders') iconName = focused ? 'receipt' : 'receipt-outline';
          else if (route.name === 'Earnings') iconName = focused ? 'wallet' : 'wallet-outline';
          else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';
          return (
            <View style={focused ? { backgroundColor: COLORS.primary + '15', borderRadius: 10, padding: 6 } : { padding: 6 }}>
              <Ionicons name={iconName} size={22} color={color} />
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} options={{ tabBarLabel: 'Hartă' }} />
      <Tab.Screen name="Orders" component={OrdersHistoryScreen} options={{ tabBarLabel: 'Comenzi' }} />
      <Tab.Screen name="Earnings" component={EarningsScreen} options={{ tabBarLabel: 'Câștiguri' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profil' }} />
    </Tab.Navigator>
  );
}

import { GestureHandlerRootView } from 'react-native-gesture-handler';

// App-wide status strip: queued status changes, changes the queue gave up on,
// and a push problem. Every one of these used to fail silently.
function StatusBanners({ pushWarning }: { pushWarning: string | null }) {
  const { pending, givenUp, dismissGiveUp } = useOfflineSync(true);
  if (pending === 0 && givenUp === 0 && !pushWarning) return null;
  return (
    <View style={banner.wrap} pointerEvents="box-none">
      {pending > 0 && (
        <View style={banner.row}>
          <Text style={banner.text}>
            {pending} {pending === 1 ? 'acțiune în așteptare' : 'acțiuni în așteptare'} — se sincronizează…
          </Text>
        </View>
      )}
      {givenUp > 0 && (
        <TouchableOpacity style={[banner.row, banner.error]} onPress={() => void dismissGiveUp()}>
          <Text style={banner.text}>
            {givenUp} {givenUp === 1 ? 'acțiune nu s-a putut sincroniza' : 'acțiuni nu s-au putut sincroniza'} — verifică
            livrarea. Atinge pentru „Am înțeles”.
          </Text>
        </TouchableOpacity>
      )}
      {pushWarning && (
        <View style={[banner.row, banner.warn]}>
          <Text style={banner.text}>{pushWarning}</Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [pushWarning, setPushWarning] = useState<string | null>(null);

  // Only a COURIER session gets in: a stored session is checked against the
  // couriers row here, a fresh login in signIn() (LoginScreen → onSignedIn).
  // onAuthStateChange therefore only ever signs OUT — SIGNED_IN fires before
  // that check and used to let a customer account in (and register its push).
  useEffect(() => {
    restoreCourierSession()
      .then(setSignedIn)
      .catch((err: unknown) => console.warn('[auth] getSession', err))
      .finally(() => setChecking(false));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) setSignedIn(false);
      if (event === 'SIGNED_OUT') void stopDeliveryTracking().catch((err: unknown) => console.warn('[gps] stop', err));
    });
    return () => subscription.unsubscribe();
  }, []);

  // Offer push tapped → the Map tab (the only place the OfferCard renders),
  // with a fresh param so MapScreen refetches the live offer at once. A tap that
  // cold-starts the app waits for the navigator (onReady).
  const pendingOfferTap = useRef(false);
  const flushOfferTap = useCallback(() => {
    if (!pendingOfferTap.current || !navRef.isReady()) return;
    pendingOfferTap.current = false;
    const toOffer = () => navRef.navigate('Main', { screen: 'Map', params: { offerTapAt: Date.now() } });
    if (navRef.getCurrentRoute()?.name !== 'ActiveDelivery') return toOffer();
    // On ActiveDelivery the push is stale only while the server still has an order on his hands
    // (offers go to online couriers): going to Map would pop a live delivery. A screen left open
    // after a cancel/reassign must not swallow a live 30 s offer (verifier, 2026-10-04).
    void hasActiveDelivery().then((active) => {
      if (!active) toOffer();
    }, () => undefined);
  }, []);
  useEffect(
    () =>
      onOfferTapped(() => {
        pendingOfferTap.current = true;
        flushOfferTap();
      }),
    [flushOfferTap],
  );

  // Push registration per signed-in session (also refreshes last_seen_at).
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void registerForPush().then((warning) => {
      if (!cancelled) setPushWarning(warning);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (checking) return <View style={{ flex: 1, backgroundColor: '#0D0D1F' }} />;

  if (!signedIn) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <LoginScreen onSignedIn={() => setSignedIn(true)} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer ref={navRef} onReady={flushOfferTap}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="ActiveDelivery" component={ActiveDeliveryScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBanners pushWarning={pushWarning} />
    </GestureHandlerRootView>
  );
}

const banner = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, bottom: 96, gap: 6 },
  row: {
    backgroundColor: 'rgba(26,26,46,0.95)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  error: { borderColor: 'rgba(233,69,96,0.6)' },
  warn: { borderColor: 'rgba(212,175,55,0.5)' },
  text: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
