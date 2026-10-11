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
import * as ImagePicker from 'expo-image-picker';
import { CHISINAU_CENTER, fetchActiveOrder, getMyCourierId, markArrivedAtRestaurant, reportIssue, uploadDeliveryProof, userMessage, type DriverOrder } from '../lib/api';
import { ISSUE_LABELS, issueKindsFor, issueReportedText, type IssueKind } from '../lib/issues';
import { navUrl, pickupCode, telUrl } from '../lib/orderView';
import { advanceOrEnqueue } from '../lib/offlineQueue';
import { startDeliveryTracking, stopDeliveryTracking } from '../lib/backgroundLocation';
import { askBackgroundDisclosure } from '../lib/locationDisclosure';
import { useDevicePosition } from '../hooks/useDevicePosition';

const { width } = Dimensions.get('window');
const SWIPE_THRESHOLD = width * 0.55;

interface Props {
  route: any;
  navigation: any;
}

export default function ActiveDeliveryScreen({ route, navigation }: Props) {
  // The order passed in was read BEFORE this courier was assigned, when RLS still
  // hid the drop-off (pin, door details, phone). Re-read now and every 10 s until the
  // drop-off is readable (a failed first read used to leave the placeholder for good).
  // Until then "Spre client" is hidden instead of searching Maps for the placeholder text.
  const [order, setOrder] = useState<DriverOrder & { status?: string }>(route.params.order);
  const dropoffKnown = order.dropoff !== null || order.dropoffText !== null;
  useEffect(() => {
    if (dropoffKnown) return;
    let alive = true;
    const refresh = () =>
      fetchActiveOrder()
        .then((active) => {
          if (alive && active && active.order.id === route.params.order.id) setOrder(active.order);
        })
        .catch((e: unknown) => console.warn('[order] refresh', e));
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [route.params.order.id, dropoffKnown]);
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
  // (src/lib/backgroundLocation.ts, from pickup — the web's window), so it
  // survives a locked screen. This hook only draws the courier's own marker.
  const broadcasting = status === 'delivering';
  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const { position: livePosition, error: geoError } = useDevicePosition();

  const stopGps = () => stopDeliveryTracking().catch((e: unknown) => console.warn('[gps] stop', e));

  // From pickup on (also when the swipe was queued offline: the task holds
  // until the server confirms en_route, see lib/gpsGate).
  const startGps = () => {
    getMyCourierId()
      .then((courierId) => (courierId ? startDeliveryTracking(order.id, courierId, askBackgroundDisclosure) : null))
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

  // Proof-of-delivery photo (soft signal, never a gate): camera only, uploaded to the private bucket.
  const [proofSending, setProofSending] = useState(false);
  const [proofSaved, setProofSaved] = useState(false);
  const handleProofPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera nu e permisă', 'Permite accesul la cameră din setările telefonului ca să faci poza la livrare.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.4, allowsEditing: false, exif: false });
    if (shot.canceled || shot.assets.length === 0) return;
    setProofSending(true);
    const err = await uploadDeliveryProof(order.id, shot.assets[0].uri);
    setProofSending(false);
    if (err) {
      Alert.alert('Poza nu s-a salvat', err);
      return;
    }
    setProofSaved(true);
  };

  // Problem report: one tap per kind; the server ignores a repeat (returns false) instead of stacking.
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueSending, setIssueSending] = useState(false);
  const handleReport = async (kind: IssueKind) => {
    setIssueSending(true);
    const { error, isNew } = await reportIssue(order.id, kind);
    setIssueSending(false);
    if (error) {
      Alert.alert('Nu s-a putut trimite', error);
      return;
    }
    setIssueOpen(false);
    Alert.alert(ISSUE_LABELS[kind], issueReportedText(isNew));
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

  // The courier's own marker only with a real fix (no placeholder point on the map).
  const courierCoord = livePosition ? { latitude: livePosition.lat, longitude: livePosition.lng } : null;
  // Pickup and drop-off only when they have a real pin — no invented points.
  const pickupCoord = order.pickup ? { latitude: order.pickup.lat, longitude: order.pickup.lng } : null;
  const dropoffCoord = order.dropoff ? { latitude: order.dropoff.lat, longitude: order.dropoff.lng } : null;
  const routeCoords = [courierCoord, pickupCoord, dropoffCoord].filter((c): c is NonNullable<typeof c> => c !== null);
  const regionCenter = order.pickup ?? order.dropoff ?? CHISINAU_CENTER;

  // The active leg: the restaurant until pickup, then the customer.
  const legNavUrl =
    status === 'pickup' ? navUrl(order.pickup, order.pickupAddress) : navUrl(order.dropoff, order.dropoffText);
  const legPhoneUrl = status === 'pickup' ? telUrl(order.restaurantPhone) : telUrl(order.customerPhone);
  const openUrl = (url: string) =>
    Linking.openURL(url).catch(() => Alert.alert('Nu s-a putut deschide', 'Verifică dacă ai o aplicație de hărți sau telefon.'));

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
          latitude: regionCenter.lat,
          longitude: regionCenter.lng,
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
        {courierCoord && (
          <Marker coordinate={courierCoord} tappable>
            <View style={styles.courierMarker}>
              <Text style={{ fontSize: 18 }}>🛵</Text>
            </View>
          </Marker>
        )}
        {pickupCoord && (
          <Marker coordinate={pickupCoord} tappable>
            <View style={[styles.pointMarker, { backgroundColor: COLORS.success }]}>
              <Ionicons name="restaurant" size={14} color={COLORS.white} />
            </View>
          </Marker>
        )}
        {dropoffCoord && (
          <Marker coordinate={dropoffCoord} tappable>
            <View style={[styles.pointMarker, { backgroundColor: COLORS.primary }]}>
              <Ionicons name="location" size={14} color={COLORS.white} />
            </View>
          </Marker>
        )}
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

        {/* Keeps the logo centred; there is no notification inbox yet. */}
        <View style={styles.headerBtn} />
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

          {/* Handover code the kitchen asks for (RESTAURANT's rule): big, before "Am ridicat". */}
          {status === 'pickup' && pickupCode(order.orderNumber) && (
            <View style={[styles.gpsBanner, { justifyContent: 'center', paddingVertical: 14 }]}>
              <Text style={[styles.gpsBannerText, { fontSize: 22, fontWeight: '800', letterSpacing: 2 }]}>
                Cod ridicare: {pickupCode(order.orderNumber)}
              </Text>
            </View>
          )}

          {status === 'pickup' && (
            <TouchableOpacity style={styles.gpsBanner} onPress={handleArrived} disabled={arrived}>
              <Ionicons name={arrived ? 'checkmark-circle' : 'storefront'} size={16} color={COLORS.white} />
              <Text style={styles.gpsBannerText}>{arrived ? 'Sosirea la restaurant a fost înregistrată' : 'Am ajuns la restaurant'}</Text>
            </TouchableOpacity>
          )}

          {(legNavUrl || legPhoneUrl) && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {legNavUrl && (
                <TouchableOpacity style={[styles.gpsBanner, { flex: 1 }]} onPress={() => openUrl(legNavUrl)}>
                  <Ionicons name="navigate" size={16} color={COLORS.white} />
                  <Text style={styles.gpsBannerText}>{status === 'pickup' ? 'Spre restaurant' : 'Spre client'}</Text>
                </TouchableOpacity>
              )}
              {legPhoneUrl && (
                <TouchableOpacity style={[styles.gpsBanner, { flex: 1 }]} onPress={() => openUrl(legPhoneUrl)}>
                  <Ionicons name="call" size={16} color={COLORS.white} />
                  <Text style={styles.gpsBannerText}>{status === 'pickup' ? 'Sună restaurantul' : 'Sună clientul'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Proof of delivery — only on the delivery leg (attach_delivery_proof accepts en_route). */}
          {status === 'delivering' && (
            <TouchableOpacity
              style={[styles.gpsBanner, { opacity: proofSending ? 0.5 : 1 }]}
              onPress={() => void handleProofPhoto()}
              disabled={proofSending}
            >
              <Ionicons name={proofSaved ? 'checkmark-circle' : 'camera'} size={16} color={COLORS.white} />
              <Text style={styles.gpsBannerText}>
                {proofSending ? 'Se încarcă poza…' : proofSaved ? 'Poza de livrare e salvată (poți face alta)' : 'Fă o poză la livrare'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Problem report — kinds follow the leg (same rule as courier_report_issue). */}
          {status !== 'delivered' && (
            <TouchableOpacity style={styles.gpsBanner} onPress={() => setIssueOpen((o) => !o)} disabled={issueSending}>
              <Ionicons name="alert-circle" size={16} color={COLORS.white} />
              <Text style={styles.gpsBannerText}>Raportează o problemă</Text>
            </TouchableOpacity>
          )}
          {issueOpen &&
            issueKindsFor(status).map((kind) => (
              <TouchableOpacity
                key={kind}
                style={[styles.gpsBanner, { opacity: issueSending ? 0.5 : 1 }]}
                onPress={() => void handleReport(kind)}
                disabled={issueSending}
              >
                <Ionicons name="chevron-forward" size={16} color={COLORS.white} />
                <Text style={styles.gpsBannerText}>{ISSUE_LABELS[kind]}</Text>
              </TouchableOpacity>
            ))}

          {/* Customer Info Card */}
          <View style={styles.customerCard}>
            <View style={styles.customerAvatar}>
              <Text style={styles.avatarText}>{order.customerName.charAt(0)}</Text>
            </View>
            <View style={styles.customerInfo}>
              <Text style={styles.customerName}>{order.customerName}</Text>
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
              {status !== 'pickup' && order.deliveryDoor ? (
                <Text style={styles.addressText}>{order.deliveryDoor}</Text>
              ) : null}
              {status !== 'pickup' && order.deliveryNotes ? (
                <Text style={styles.addressText}>📝 {order.deliveryNotes}</Text>
              ) : null}
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

