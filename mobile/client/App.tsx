import React, { useEffect } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';

import HomeScreen from './src/screens/HomeScreen';
import SearchScreen from './src/screens/SearchScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import RestaurantScreen from './src/screens/RestaurantScreen';
import CartScreen from './src/screens/CartScreen';
import LoginScreen from './src/screens/LoginScreen';
import OrderTrackingScreen from './src/screens/OrderTrackingScreen';
import CateringScreen from './src/screens/CateringScreen';
import ConciergeScreen from './src/screens/ConciergeScreen';
import { COLORS } from './src/theme';
import { supabase } from './src/lib/supabase';
import { hydrateCart } from './src/lib/cart';
import { createPushOpener, onNotificationOpened, pushTarget, registerForPush } from './src/lib/push';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef<any>();
// A tap that arrives before the navigator is ready (cold start) waits for onReady.
const pushOpener = createPushOpener(navigationRef);

function HomeTabs() {
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
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ focused, color }) => {
          let iconName: any;
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Search') iconName = focused ? 'search' : 'search-outline';
          else if (route.name === 'Orders') iconName = focused ? 'receipt' : 'receipt-outline';
          else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';
          return (
            <View style={focused ? { backgroundColor: COLORS.primary + '15', borderRadius: 10, padding: 6 } : { padding: 6 }}>
              <Ionicons name={iconName} size={22} color={color} />
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Acasă' }} />
      <Tab.Screen name="Search" component={SearchScreen} options={{ tabBarLabel: 'Caută' }} />
      <Tab.Screen name="Orders" component={OrdersScreen} options={{ tabBarLabel: 'Comenzi' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profil' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  useEffect(() => {
    hydrateCart();
    // Push token follows the session: registered on every sign-in / app start with a
    // session (tokens rotate), removed on sign-out (ProfileScreen, before signOut).
    const { data: auth } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        registerForPush().then(r => { if (r !== 'registered') console.info('[push]', r); });
      }
    });
    const offTap = onNotificationOpened(pushOpener.open);
    // Cold start from a notification tap.
    Notifications.getLastNotificationResponseAsync()
      .then(resp => {
        const target = pushTarget(resp?.notification.request.content.data?.url);
        if (target) pushOpener.open(target);
      })
      .catch(() => {});
    return () => {
      auth.subscription.unsubscribe();
      offTap();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef} onReady={pushOpener.flush}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={HomeTabs} />
          <Stack.Screen name="Restaurant" component={RestaurantScreen} />
          <Stack.Screen name="Cart" component={CartScreen} />
          <Stack.Screen name="OrderTracking" component={OrderTrackingScreen} />
          <Stack.Screen name="Catering" component={CateringScreen} />
          <Stack.Screen name="Concierge" component={ConciergeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} options={{ presentation: 'modal' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
