import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Animated,
  PanResponder,
  Dimensions,
  Alert,
  Linking,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { COLORS } from '../theme';
import { styles, darkMapStyle } from './ActiveDeliveryScreen.styles';
import { CHISINAU_CENTER, getMyCourierId, markArrivedAtRestaurant, userMessage } from '../lib/api';
import { advanceOrEnqueue } from '../lib/offlineQueue';
import { startDeliveryTracking, stopDeliveryTracking } from '../lib/backgroundLocation';
import { useDevicePosition } from '../hooks/useDevicePosition';

const { width } = Dimensions.get('window');
const SWIPE_THRESHOLD = width * 0.55;

interface Props {
  route: any;
  navigation: any;
}

export default function ActiveDeliveryScreen({ route, navigation }: Props) {
  const { order } = route.params;
  // Derive the UI step from the order's REAL DB status so a remount into an already
  // picked-up/en_route delivery resumes correctly instead of resetting to 'pickup'
  // (which made the swipe call picked_up -> the RPC rejects en_route->picked_up and
  // the delivery became uncompletable in-app). (audit #3)
  const initialStep: 'pickup' | 'delivering' | 'delivered' =
    order?.status === 'delivered'
      ? 'delivered'
      : order?.status === 'picked_up' || order?.status === 'en_route'
        ? 'delivering'
        : 'pickup';
  const [status, setStatus] = useState<'pickup' | 'delivering' | 'delivered'>(initialStep);
  const [arrived, setArrived] = useState(false);
  const swipeX = useRef(new Animated.Value(0)).current;

  // Broadcasting to the customer runs in the BACKGROUND task
  // (src/lib/backgroundLocation.ts, started at pickup — the web's window), so it
  // survives a locked screen. This hook only draws the courier's own marker.
  const broadcasting = status === 'delivering';
  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const { position: livePosition, error: geoError } = useDevicePosition();

  const stopGps = () => stopDeliveryTracking().catch((e: unknown) => console.warn('[gps] stop', e));

  // From pickup on (also when the swipe was queued offline: the task holds
  // until the server confirms en_route, see lib/gpsGate).
  const startGps = () => {
    getMyCourierId()
      .then((courierId) => (courierId ? startDeliveryTracking(order.id, courierId) : null))
      .then(setGpsWarning)
      .catch((e: unknown) => setGpsWarning(userMessage(e, 'GPS-ul în fundal nu a putut porni.')));
  };

  // Cancelled or advanced elsewhere: nothing to do here any more.
  const closeWith = (message: string) => {
    void stopGps();
    Alert.alert('Comanda nu mai e activă', message, [{ text: 'OK', onPress: () => navigation.goBack() }]);
  };

  // Soft ops signal only (wait-time KPI), never a gate on the delivery.
  const handleArrived = async () => {
    const err = await markArrivedAtRestaurant(order.id);
    if (err) {
      Alert.alert('Nu s-a putut trimite', err);
      return;
    }
    setArrived(true);
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gesture) => {
      if (gesture.dx > 0) {
        swipeX.setValue(Math.min(gesture.dx, SWIPE_THRESHOLD));
      }
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx > SWIPE_THRESHOLD) {
        Animated.spring(swipeX, { toValue: SWIPE_THRESHOLD, useNativeDriver: true }).start(async () => {
          if (status === 'pickup') {
            // One target (en_route); the hops in between are walked by
            // advanceThrough, online now or from the offline queue later.
            const { error, closed } = await advanceOrEnqueue(order.id, 'en_route');
            if (error) {
              swipeX.setValue(0);
              if (closed) closeWith(error);
              else Alert.alert('Eroare', error);
              return;
            }
            setStatus('delivering');
            startGps();
            swipeX.setValue(0);
          } else if (status === 'delivering') {
            Alert.alert('Încasare', 'Ai încasat plata (cash/POS)?', [
              {
                text: 'Da, încasat',
                onPress: async () => {
                  const { error, queued, closed } = await advanceOrEnqueue(order.id, 'delivered', true);
                  if (error) {
                    swipeX.setValue(0);
                    if (closed) closeWith(error);
                    else Alert.alert('Eroare', error);
                    return;
                  }
                  setStatus('delivered');
                  // Delivered on the phone = the customer stops seeing the courier,
                  // even while the confirmation still waits in the offline queue.
                  void stopGps();
                  Alert.alert(
                    queued ? 'Salvat fără semnal' : '✅ Livrare finalizată!',
                    queued
                      ? 'Livrarea se confirmă automat când revine conexiunea.'
                      : `Comanda a ajuns la client. Câștig (minim): ${order.earnings}`,
                    [{ text: 'OK', onPress: () => navigation.goBack() }],
                  );
                },
              },
              {
                text: 'Nu încă',
                style: 'cancel',
                onPress: () => swipeX.setValue(0),
              },
            ]);
          }
        });
      } else {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  });

  const routeCoords = [
    // Real device GPS once a fix lands; the city center is only a placeholder
    // while it warms up or if location permission was denied.
    livePosition
      ? { latitude: livePosition.lat, longitude: livePosition.lng }
      : { latitude: CHISINAU_CENTER.lat, longitude: CHISINAU_CENTER.lng }, // courier
    { latitude: order.lat, longitude: order.lng }, // pickup
    { latitude: order.lat + 0.008, longitude: order.lng + 0.005 }, // delivery
  ];

  const getSwipeText = () => {
    if (status === 'pickup') return 'Glisează: am ridicat comanda →';
    return 'Glisează: am livrat →';
  };

  const getStatusSteps = () => [
    { label: 'Ridicată', done: status === 'delivering' || status === 'delivered' },
    { label: 'În drum', done: status === 'delivering' || status === 'delivered' },
    { label: 'Livrată', done: status === 'delivered' },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Map */}
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: order.lat,
          longitude: order.lng,
          latitudeDelta: 0.025,
          longitudeDelta: 0.025,
        }}
        customMapStyle={darkMapStyle}
      >
        <Polyline
          coordinates={routeCoords}
          strokeColor={COLORS.primary}
          strokeWidth={4}
          lineDashPattern={[8, 4]}
        />
        <Marker coordinate={routeCoords[0]} tappable>
          <View style={styles.courierMarker}>
            <Text style={{ fontSize: 18 }}>🛵</Text>
          </View>
        </Marker>
        <Marker coordinate={routeCoords[1]} tappable>
          <View style={[styles.pointMarker, { backgroundColor: COLORS.success }]}>
            <Ionicons name="restaurant" size={14} color={COLORS.white} />
          </View>
        </Marker>
        <Marker coordinate={routeCoords[2]} tappable>
          <View style={[styles.pointMarker, { backgroundColor: COLORS.primary }]}>
            <Ionicons name="location" size={14} color={COLORS.white} />
          </View>
        </Marker>
      </MapView>

      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="menu" size={24} color={COLORS.white} />
        </TouchableOpacity>

        {/* Center: Logo */}
        <View style={styles.headerLogo}>
          <Text style={styles.headerLogoIcon}>🐉</Text>
          <View style={styles.headerLogoTextContainer}>
            <Text style={styles.headerLogoTitle}>DRAGONS</Text>
            <Text style={styles.headerLogoSubtitle}>COURIERS</Text>
            <Text style={styles.headerLogoSub}>DRIVER</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.headerBtn}>
          <Ionicons name="notifications" size={20} color={COLORS.white} />
          <View style={styles.notificationBadge}>
            <Text style={styles.badgeText}>3</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Floating Address Banner inside Map */}
      <View style={styles.addressBanner}>
        <Ionicons name="navigate-circle" size={20} color="#4CD964" />
        <Text style={styles.addressBannerText} numberOfLines={1}>
          Livrezi la: {order.deliveryAddress}
        </Text>
      </View>

      {/* Bottom Sheet */}
      <View style={styles.bottomSheet}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Status Steps */}
          <View style={styles.statusSteps}>
            {getStatusSteps().map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={[styles.stepDot, step.done && styles.stepDotDone]} />
                {i < 2 && <View style={[styles.stepLine, step.done && styles.stepLineDone]} />}
                <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]}>{step.label}</Text>
              </View>
            ))}
          </View>

          {broadcasting && (
            <View style={styles.gpsBanner}>
              <View style={[styles.gpsDot, geoError ? styles.gpsDotError : null]} />
              <Text style={styles.gpsBannerText}>
                {gpsWarning ?? geoError ?? 'Locația ta se transmite live clientului'}
              </Text>
            </View>
          )}

          {status === 'pickup' && (
            <TouchableOpacity style={styles.gpsBanner} onPress={handleArrived} disabled={arrived}>
              <Ionicons name={arrived ? 'checkmark-circle' : 'storefront'} size={16} color={COLORS.white} />
              <Text style={styles.gpsBannerText}>{arrived ? 'Sosirea la restaurant a fost înregistrată' : 'Am ajuns la restaurant'}</Text>
            </TouchableOpacity>
          )}

          {/* Customer Info Card */}
          <View style={styles.customerCard}>
            <View style={styles.customerAvatar}>
              <Text style={styles.avatarText}>{order.customerName.charAt(0)}</Text>
            </View>
            <View style={styles.customerInfo}>
              <Text style={styles.customerName}>{order.customerName}</Text>
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={12} color={COLORS.gold} />
                <Text style={styles.ratingText}>4.9</Text>
              </View>
            </View>

          </View>

          {/* Order Items with Watermark */}
          <View style={styles.itemsSection}>
            <View style={styles.itemsHeader}>
              <Text style={styles.itemsTitle}>PRODUSE COMANDATE</Text>
              <View style={styles.watermarkContainer}>
                <Text style={styles.watermarkIcon}>🐉</Text>
              </View>
            </View>
            <Text style={styles.itemsList}>{order.items}</Text>
          </View>

          {/* Delivery Address & Customer Phone */}
          <View style={styles.addressSection}>
            <Ionicons name="location" size={20} color={COLORS.primary} />
            <View style={styles.addressInfo}>
              <Text style={styles.addressLabel}>
                {status === 'pickup' ? 'RIDICĂ DE LA' : 'LIVREAZĂ LA'}
              </Text>
              <Text style={styles.addressText}>
                {status === 'pickup' ? order.pickupAddress : order.deliveryAddress}
              </Text>
            </View>
          </View>


          <View style={{ height: 110 }} />
        </ScrollView>

        {/* Swipe Button */}
        {status !== 'delivered' && (
          <View style={styles.swipeContainer}>
            <View style={styles.swipeTrack}>
              <Animated.View
                style={[styles.swipeThumb, { transform: [{ translateX: swipeX }] }]}
                {...panResponder.panHandlers}
              >
                <View style={styles.swipeIconWrapper}>
                  <Text style={styles.swipeIconText}>🐉</Text>
                </View>
              </Animated.View>
              <Text style={styles.swipeText}>{getSwipeText()}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

