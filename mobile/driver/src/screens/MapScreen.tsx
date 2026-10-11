import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Animated,
  AppState,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import { COLORS } from '../theme';
import { styles, darkMapStyle } from './MapScreen.styles';
import {
  fetchAvailableOrders,
  fetchActiveOrder,
  fetchTodaySummary,
  fetchMyCourierStatus,
  claimOrder,
  setOnline,
  getMyCourierId,
  acceptDispatchOffer,
  declineDispatchOffer,
  userMessage,
  upsertMyLocation,
  CHISINAU_CENTER,
  CourierStatus,
  DriverOrder,
} from '../lib/api';
import { resumeDeliveryTracking, startDeliveryTracking, stopDeliveryTracking } from '../lib/backgroundLocation';
import { askBackgroundDisclosure } from '../lib/locationDisclosure';
import { useDevicePosition } from '../hooks/useDevicePosition';
import { useLiveOffer } from '../hooks/useLiveOffer';
import { heartbeatDue } from '../lib/heartbeat';
import OfferCard from '../components/OfferCard';
import { Alert } from 'react-native';

type Order = DriverOrder;

interface Props {
  navigation: any;
  route?: { params?: { offerTapAt?: number } };
}

const REFRESH_MS = 15_000;

export default function MapScreen({ navigation, route }: Props) {
  // The SERVER owns availability. null = not loaded yet; the app never assumes
  // "online" (it used to force set_courier_online_status(online) on every launch).
  const [courierStatus, setCourierStatus] = useState<CourierStatus | null>(null);
  const [toggling, setToggling] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [todayNet, setTodayNet] = useState<number | null>(null);
  const [todayPending, setTodayPending] = useState(0);
  const [activeDelivery, setActiveDelivery] = useState<{ order: DriverOrder; status: string } | null>(null);
  const [activeLoaded, setActiveLoaded] = useState(false);
  const [courierId, setCourierId] = useState<string | null>(null);
  const [offerPending, setOfferPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trackingWarning, setTrackingWarning] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  // Real device GPS for the courier's own map marker.
  const { position: devicePosition, error: gpsError } = useDevicePosition();

  const isOnline = courierStatus === 'online' || courierStatus === 'on_delivery';
  const { offer: liveOffer, setOffer: setLiveOffer, error: offerError, socketHealthy, reload: refreshOffer } =
    useLiveOffer(courierId, isOnline);

  // Every read surfaces its failure in the banner — nothing is swallowed.
  const refreshAll = useCallback(async () => {
    try {
      const [id, status, active, available, today] = await Promise.all([
        getMyCourierId(),
        fetchMyCourierStatus(),
        fetchActiveOrder(),
        fetchAvailableOrders(),
        fetchTodaySummary(),
      ]);
      setCourierId(id);
      setCourierStatus(status);
      setActiveDelivery(active);
      setActiveLoaded(true);
      setOrders(available);
      setTodayNet(today ? Math.round(today.netMdl) : 0);
      setTodayPending(today?.pendingCount ?? 0);
      setLoadError(null);
    } catch (err) {
      setLoadError(userMessage(err, 'Nu am putut încărca datele. Revino în aplicație sau încearcă din nou.'));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  useEffect(() => {
    const interval = setInterval(() => void refreshAll(), REFRESH_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshAll();
      // A start attempted while backgrounded (Android refuses the foreground
      // service then) is re-armed here instead of never.
      resumeDeliveryTracking()
        .then((warning) => warning && setTrackingWarning(warning))
        .catch((err: unknown) => setTrackingWarning(userMessage(err, 'GPS-ul în fundal nu a putut porni.')));
    });
    return () => {
      clearInterval(interval);
      appState.remove();
    };
  }, [refreshAll]);

  // Idle heartbeat (lib/heartbeat): online with no delivery -> re-send the last fix so
  // dispatch ranks this courier on a real position. A stationary phone fires no new fix,
  // hence the timer reading the latest one from a ref.
  const positionRef = useRef(devicePosition);
  positionRef.current = devicePosition;
  const lastBeatRef = useRef(0);
  const idleOnline = courierStatus === 'online' && activeLoaded && !activeDelivery;
  useEffect(() => {
    if (!idleOnline || !courierId) return;
    const tick = () => {
      const now = Date.now();
      const point = positionRef.current;
      if (!point || !heartbeatDue({ online: true, delivering: false, hasFix: true, lastAt: lastBeatRef.current, now })) return;
      lastBeatRef.current = now;
      void upsertMyLocation(courierId, point).then((err) => {
        if (err) lastBeatRef.current = 0; // retry on the next tick instead of going stale
      });
    };
    tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [idleOnline, courierId]);

  // Offer push tapped (App.tsx navigates here with a fresh offerTapAt): fetch
  // the live offer now instead of waiting for the next poll.
  const offerTapAt = route?.params?.offerTapAt;
  useEffect(() => {
    if (offerTapAt) void refreshOffer();
  }, [offerTapAt, refreshOffer]);

  // Background GPS follows the active delivery, off once it is delivered /
  // cancelled / reassigned (the next refresh sees no such order). Every fix
  // re-checks the order (lib/gpsGate): until pickup it only feeds the
  // restaurant's pickup map; the customer sees the courier from picked_up on.
  const activeOrderId = activeDelivery?.order.id ?? null;
  useEffect(() => {
    if (!activeLoaded) return;
    if (activeOrderId && courierId) {
      startDeliveryTracking(activeOrderId, courierId, askBackgroundDisclosure)
        .then(setTrackingWarning)
        .catch((err: unknown) => setTrackingWarning(userMessage(err, 'GPS-ul în fundal nu a putut porni.')));
    } else {
      setTrackingWarning(null);
      stopDeliveryTracking().catch((err: unknown) => console.warn('[gps] stop', err));
    }
  }, [activeLoaded, activeOrderId, courierId]);

  // Explicit, server-confirmed toggle. On error the server state is re-read and
  // the reason is shown (e.g. "ai o livrare activă", cash cap reached).
  const handleToggleOnline = async () => {
    if (courierStatus === null || toggling) return;
    if (courierStatus === 'on_delivery') {
      Alert.alert('Status', 'Ai o livrare activă — termin-o înainte să ieși offline.');
      return;
    }
    const goingOnline = courierStatus !== 'online';
    setToggling(true);
    const err = await setOnline(goingOnline);
    setToggling(false);
    if (err) Alert.alert('Nu s-a putut schimba statusul', err);
    await refreshAll();
  };

  const handleAcceptOffer = async () => {
    if (!liveOffer) return;
    setOfferPending(true);
    const err = await acceptDispatchOffer(liveOffer.offer.id);
    setOfferPending(false);
    if (err) {
      Alert.alert('Nu s-a putut accepta', err);
      setLiveOffer(null);
      void refreshOffer();
      return;
    }
    const { order } = liveOffer;
    setLiveOffer(null);
    // GPS starts from the refresh (effect above); the customer sees the courier only from pickup.
    navigation.navigate('ActiveDelivery', { order: { ...order, status: 'courier_assigned' } });
    void refreshAll();
  };

  const handleDeclineOffer = async () => {
    if (!liveOffer) return;
    setOfferPending(true);
    const err = await declineDispatchOffer(liveOffer.offer.id);
    setOfferPending(false);
    if (err) Alert.alert('Refuzul nu a fost trimis', err);
    setLiveOffer(null);
    void refreshOffer();
  };

  const handleOfferExpire = () => {
    setLiveOffer(null);
    void refreshOffer();
  };

  const showOrderCard = (order: Order) => {
    setCurrentOrder(order);
    Animated.spring(slideAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  };

  const hideOrderCard = () => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setCurrentOrder(null));
  };

  const acceptOrder = async () => {
    if (!currentOrder) return;
    const order = currentOrder;
    const error = await claimOrder(order.id);
    if (error) {
      Alert.alert('Nu s-a putut accepta', error);
      hideOrderCard();
      void refreshAll();
      return;
    }
    navigation.navigate('ActiveDelivery', { order: { ...order, status: 'courier_assigned' } });
    hideOrderCard();
    void refreshAll();
  };

  const cardTranslateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  // One banner, most urgent first.
  const bannerMessage =
    loadError ??
    offerError ??
    (isOnline && !socketHealthy ? 'Reconectare… ofertele se verifică automat la câteva secunde.' : null) ??
    trackingWarning ??
    gpsError;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Map */}
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: CHISINAU_CENTER.lat,
          longitude: CHISINAU_CENTER.lng,
          latitudeDelta: 0.035,
          longitudeDelta: 0.035,
        }}
        customMapStyle={darkMapStyle}
      >
        {/* Courier position — only a real device fix; no marker until it lands
            (the banner explains a denied permission). */}
        {devicePosition && (
          <Marker coordinate={{ latitude: devicePosition.lat, longitude: devicePosition.lng }} tappable>
            <View style={styles.courierMarker}>
              <Text style={styles.courierEmoji}>🛵</Text>
            </View>
          </Marker>
        )}

        {/* Order markers */}
        {/* Only restaurants with a real pin get a marker; the list below still shows every order. */}
        {orders.map(order => order.pickup && (
          <Marker
            key={order.id}
            coordinate={{ latitude: order.pickup.lat, longitude: order.pickup.lng }}
            onPress={() => showOrderCard(order)}
            tappable
          >
            <View style={styles.orderMarker}>
              <Ionicons name="restaurant" size={16} color={COLORS.white} />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Top Header */}
      <View style={styles.topBar}>
        {/* Left: Online Status Button */}
        <TouchableOpacity
          style={[styles.statusBtn, isOnline ? styles.statusOnline : styles.statusOffline]}
          onPress={handleToggleOnline}
          disabled={courierStatus === null || toggling}
        >
          {courierStatus === null || toggling ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <View style={[styles.statusDot, { backgroundColor: isOnline ? '#4CD964' : '#FF3B30' }]} />
          )}
          <Text style={styles.statusText}>
            {courierStatus === null ? '…' : courierStatus === 'on_delivery' ? 'În livrare' : isOnline ? 'Online' : 'Offline'}
          </Text>
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

        {/* Right: Today's Earnings */}
        <View style={styles.earningsBox}>
          <Text style={styles.earningsLabel}>Azi (net)</Text>
          <Text style={styles.earningsText}>{todayNet === null ? '…' : `${todayNet} MDL`}</Text>
          {todayPending > 0 && (
            <Text style={styles.earningsLabel}>
              +{todayPending} {todayPending === 1 ? 'neîncasată' : 'neîncasate'}
            </Text>
          )}
        </View>
      </View>

      {/* GPS permission banner — hidden while an offer is showing so the two
          don't stack on top of each other. */}
      {bannerMessage && !liveOffer && (
        <View style={styles.gpsBanner}>
          <Ionicons name="warning" size={16} color={COLORS.primary} />
          <Text style={styles.gpsBannerText} numberOfLines={3}>
            {bannerMessage}
          </Text>
        </View>
      )}

      {/* Push-dispatch offer — scored, exclusive, 30s to respond. */}
      {liveOffer && (
        <OfferCard
          offerId={liveOffer.offer.id}
          order={liveOffer.order}
          expiresAt={liveOffer.offer.expiresAt}
          distanceKm={liveOffer.offer.distanceKm}
          pending={offerPending}
          onAccept={handleAcceptOffer}
          onDecline={handleDeclineOffer}
          onExpire={handleOfferExpire}
        />
      )}

      {/* Bottom info */}
      {!currentOrder && (
        <View style={styles.bottomInfo}>
          <TouchableOpacity
            style={styles.waitingCard}
            activeOpacity={activeDelivery ? 0.8 : 1}
            disabled={!activeDelivery}
            onPress={() => activeDelivery && navigation.navigate('ActiveDelivery', { order: activeDelivery.order })}
          >
            <View style={styles.pulseContainer}>
              <View style={styles.pulseDot} />
            </View>
            <View>
              <Text style={styles.waitingTitle}>
                {activeDelivery ? 'Ai o livrare activă' : isOnline ? 'Așteptăm comenzi...' : 'Ești offline'}
              </Text>
              <Text style={styles.waitingSubtitle}>
                {activeDelivery ? `Comandă în curs — continuă livrarea` : isOnline ? `${orders.length} comenzi disponibile` : 'Intră online ca să primești comenzi'}
              </Text>
            </View>
            {activeDelivery && <Ionicons name="arrow-forward-circle" size={26} color={COLORS.primary} style={{ marginLeft: 'auto' }} />}
          </TouchableOpacity>
        </View>
      )}

      {/* Order Card */}
      {currentOrder && (
        <Animated.View style={[styles.orderCard, { transform: [{ translateY: cardTranslateY }] }]}>
          <View style={styles.orderCardHeader}>
            <View style={styles.newOrderBadge}>
              <Ionicons name="flash" size={14} color={COLORS.gold} />
              <Text style={styles.newOrderText}>Comandă disponibilă</Text>
            </View>
            <TouchableOpacity onPress={hideOrderCard}>
              <Ionicons name="close-circle" size={28} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.orderDetails}>
            <View style={styles.orderRow}>
              <View style={[styles.orderDot, { backgroundColor: '#4CD964' }]} />
              <View style={styles.orderInfo}>
                <Text style={styles.orderLabel}>RIDICARE</Text>
                <Text style={styles.orderRestaurant}>{currentOrder.restaurant}</Text>
                <Text style={styles.orderAddress}>{currentOrder.pickupAddress}</Text>
              </View>
            </View>

            <View style={styles.orderDivider} />

            <View style={styles.orderRow}>
              <View style={[styles.orderDot, { backgroundColor: COLORS.primary }]} />
              <View style={styles.orderInfo}>
                <Text style={styles.orderLabel}>LIVRARE</Text>
                <Text style={styles.orderCustomer}>{currentOrder.customerName}</Text>
                <Text style={styles.orderAddress}>{currentOrder.deliveryAddress}</Text>
              </View>
            </View>
          </View>

          <View style={styles.orderMeta}>
            <View style={styles.metaItem}>
              <Ionicons name="navigate" size={16} color={COLORS.textSecondary} />
              <Text style={styles.metaText}>{currentOrder.distance}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="cash" size={16} color={COLORS.gold} />
              <Text style={[styles.metaText, { color: COLORS.gold, fontWeight: '800' }]}>{currentOrder.earnings}</Text>
            </View>
          </View>

          <View style={styles.orderActions}>
            <TouchableOpacity style={styles.declineBtn} onPress={hideOrderCard}>
              <Text style={styles.declineBtnText}>Închide</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={acceptOrder}>
              <Text style={styles.acceptBtnText}>Preiau</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

