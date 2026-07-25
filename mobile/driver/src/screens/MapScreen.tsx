import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import { COLORS } from '../theme';
import { styles, darkMapStyle } from './MapScreen.styles';
import {
  fetchAvailableOrders,
  fetchActiveOrder,
  fetchDeliveryHistory,
  acceptOrder as apiAcceptOrder,
  setOnline,
  getMyCourierId,
  fetchMyLiveOffer,
  acceptDispatchOffer,
  declineDispatchOffer,
  subscribeMyDispatchOffers,
  CHISINAU_CENTER,
  DriverOrder,
  DispatchOfferRow,
} from '../lib/api';
import { useDevicePosition } from '../hooks/useDevicePosition';
import OfferCard from '../components/OfferCard';
import { Alert } from 'react-native';

const { width } = Dimensions.get('window');

type Order = DriverOrder;

interface Props {
  navigation: any;
}

export default function MapScreen({ navigation }: Props) {
  const [isOnline, setIsOnline] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [activeDelivery, setActiveDelivery] = useState<{ order: DriverOrder; status: string } | null>(null);
  const [courierId, setCourierId] = useState<string | null>(null);
  const [liveOffer, setLiveOffer] = useState<{ offer: DispatchOfferRow; order: DriverOrder } | null>(null);
  const [offerPending, setOfferPending] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  // Real device GPS for the courier's own map marker (finding #4 — this used
  // to be a hardcoded constant, so the marker never moved).
  const { position: devicePosition, error: gpsError } = useDevicePosition();

  const refreshOrders = useCallback(() => {
    fetchAvailableOrders().then(setOrders).catch(() => {});
  }, []);

  const refreshOffer = useCallback(() => {
    fetchMyLiveOffer().then(setLiveOffer).catch(() => {});
  }, []);

  useEffect(() => {
    refreshOrders();
    refreshOffer();
    fetchDeliveryHistory().then((h) => setTodayEarnings(h.todayEarnings)).catch(() => {});
    fetchActiveOrder().then(setActiveDelivery).catch(() => {});
    getMyCourierId().then(setCourierId).catch(() => {});
    const interval = setInterval(refreshOrders, 15000);
    return () => clearInterval(interval);
  }, [refreshOrders, refreshOffer]);

  // Push-dispatch feed (finding #21) — row-filtered by courier_id, unique
  // channel name per mount so it survives React re-mounts.
  useEffect(() => {
    if (!courierId) return;
    return subscribeMyDispatchOffers(courierId, refreshOffer);
  }, [courierId, refreshOffer]);

  // Skip guard: the revert below must not re-fire the server call (the on_delivery
  // block rejects EVERY toggle, so a naive revert would alert-loop forever).
  const skipNextToggleRef = useRef(false);
  useEffect(() => {
    if (skipNextToggleRef.current) {
      skipNextToggleRef.current = false;
      return;
    }
    // Surface the backend's block (e.g. "ai o livrare activă...") and revert the
    // local toggle instead of showing "Offline" while still on_delivery server-side.
    setOnline(isOnline).catch((err: unknown) => {
      Alert.alert('Status', err instanceof Error ? err.message : 'Nu am putut schimba statusul.');
      skipNextToggleRef.current = true;
      setIsOnline((prev) => !prev);
    });
  }, [isOnline]);

  const handleAcceptOffer = async () => {
    if (!liveOffer) return;
    setOfferPending(true);
    const err = await acceptDispatchOffer(liveOffer.offer.id);
    setOfferPending(false);
    if (err) {
      Alert.alert('Nu s-a putut accepta', err);
      setLiveOffer(null);
      refreshOffer();
      return;
    }
    const { order } = liveOffer;
    setLiveOffer(null);
    navigation.navigate('ActiveDelivery', { order });
  };

  const handleDeclineOffer = async () => {
    if (!liveOffer) return;
    setOfferPending(true);
    await declineDispatchOffer(liveOffer.offer.id);
    setOfferPending(false);
    setLiveOffer(null);
    refreshOffer();
  };

  const handleOfferExpire = () => {
    setLiveOffer(null);
    refreshOffer();
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
    const error = await apiAcceptOrder(currentOrder.id);
    if (error) {
      Alert.alert('Nu s-a putut accepta', 'Comanda a fost preluată de alt curier sau ai deja o livrare activă.');
      hideOrderCard();
      refreshOrders();
      return;
    }
    navigation.navigate('ActiveDelivery', { order: currentOrder });
    hideOrderCard();
    refreshOrders();
  };

  const cardTranslateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Map */}
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 47.0105,
          longitude: 28.8638,
          latitudeDelta: 0.035,
          longitudeDelta: 0.035,
        }}
        customMapStyle={darkMapStyle}
      >
        {/* Courier position — real device GPS, falls back to the city center
            marker only until the first fix lands or if permission is denied. */}
        <Marker
          coordinate={
            devicePosition
              ? { latitude: devicePosition.lat, longitude: devicePosition.lng }
              : { latitude: CHISINAU_CENTER.lat, longitude: CHISINAU_CENTER.lng }
          }
          tappable
        >
          <View style={styles.courierMarker}>
            <Text style={styles.courierEmoji}>🛵</Text>
          </View>
        </Marker>

        {/* Order markers */}
        {orders.map(order => (
          <Marker
            key={order.id}
            coordinate={{ latitude: order.lat, longitude: order.lng }}
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
          onPress={() => setIsOnline(!isOnline)}
        >
          <View style={[styles.statusDot, { backgroundColor: isOnline ? '#4CD964' : '#FF3B30' }]} />
          <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
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
          <Text style={styles.earningsLabel}>Earnings Today</Text>
          <Text style={styles.earningsText}>{todayEarnings} MDL</Text>
        </View>
      </View>

      {/* GPS permission banner — hidden while an offer is showing so the two
          don't stack on top of each other. */}
      {gpsError && !liveOffer && (
        <View style={styles.gpsBanner}>
          <Ionicons name="warning" size={16} color={COLORS.primary} />
          <Text style={styles.gpsBannerText} numberOfLines={2}>
            {gpsError}
          </Text>
        </View>
      )}

      {/* Push-dispatch offer — scored, exclusive, 30s to respond. */}
      {liveOffer && (
        <OfferCard
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
              <Text style={styles.newOrderText}>New Order!</Text>
            </View>
            <TouchableOpacity onPress={hideOrderCard}>
              <Ionicons name="close-circle" size={28} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.orderDetails}>
            <View style={styles.orderRow}>
              <View style={[styles.orderDot, { backgroundColor: '#4CD964' }]} />
              <View style={styles.orderInfo}>
                <Text style={styles.orderLabel}>PICKUP</Text>
                <Text style={styles.orderRestaurant}>{currentOrder.restaurant}</Text>
                <Text style={styles.orderAddress}>{currentOrder.pickupAddress}</Text>
              </View>
            </View>

            <View style={styles.orderDivider} />

            <View style={styles.orderRow}>
              <View style={[styles.orderDot, { backgroundColor: COLORS.primary }]} />
              <View style={styles.orderInfo}>
                <Text style={styles.orderLabel}>DELIVERY</Text>
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
              <Text style={styles.declineBtnText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={acceptOrder}>
              <Text style={styles.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

