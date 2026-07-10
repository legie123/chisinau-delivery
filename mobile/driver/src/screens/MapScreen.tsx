import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import { COLORS } from '../theme';

const { width } = Dimensions.get('window');

interface Order {
  id: number;
  restaurant: string;
  pickupAddress: string;
  deliveryAddress: string;
  distance: string;
  earnings: string;
  items: string;
  customerName: string;
  lat: number;
  lng: number;
}

const MOCK_ORDERS: Order[] = [
  {
    id: 1, restaurant: "Dragon's Wok", pickupAddress: "Str. Calea Victoriei 25",
    deliveryAddress: "Bd. Magheru 12, Ap. 5", distance: "2.3 km",
    earnings: "12 RON", items: "2x Pad Thai, 1x Spring Rolls",
    customerName: "Alexandru P.", lat: 44.4396, lng: 26.0963,
  },
  {
    id: 2, restaurant: "Casa Românească", pickupAddress: "Str. Lipscani 12",
    deliveryAddress: "Str. Dorobanți 88, Et. 3", distance: "3.1 km",
    earnings: "15 RON", items: "1x Ciorbă, 2x Mici, 1x Papanași",
    customerName: "Maria I.", lat: 44.4312, lng: 26.0979,
  },
  {
    id: 3, restaurant: "Sushi Dragon", pickupAddress: "Bd. Unirii 45",
    deliveryAddress: "Calea Moșilor 84, Ap. 12", distance: "1.8 km",
    earnings: "10 RON", items: "1x Dragon Roll, 1x Miso Soup",
    customerName: "Andrei V.", lat: 44.4268, lng: 26.1025,
  },
];

interface Props {
  navigation: any;
}

export default function MapScreen({ navigation }: Props) {
  const [isOnline, setIsOnline] = useState(true);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [todayEarnings] = useState(142);
  const slideAnim = useRef(new Animated.Value(0)).current;

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

  const acceptOrder = () => {
    if (currentOrder) {
      navigation.navigate('ActiveDelivery', { order: currentOrder });
      hideOrderCard();
    }
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
          latitude: 44.4312,
          longitude: 26.0979,
          latitudeDelta: 0.035,
          longitudeDelta: 0.035,
        }}
        customMapStyle={darkMapStyle}
      >
        {/* Courier position */}
        <Marker coordinate={{ latitude: 44.4340, longitude: 26.0990 }} tappable>
          <View style={styles.courierMarker}>
            <Text style={styles.courierEmoji}>🛵</Text>
          </View>
        </Marker>

        {/* Order markers */}
        {MOCK_ORDERS.map(order => (
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
          <Text style={styles.earningsText}>{todayEarnings} RON</Text>
        </View>
      </View>

      {/* Bottom info */}
      {!currentOrder && (
        <View style={styles.bottomInfo}>
          <View style={styles.waitingCard}>
            <View style={styles.pulseContainer}>
              <View style={styles.pulseDot} />
            </View>
            <View>
              <Text style={styles.waitingTitle}>
                {isOnline ? 'Waiting for orders...' : 'You are offline'}
              </Text>
              <Text style={styles.waitingSubtitle}>
                {isOnline ? `${MOCK_ORDERS.length} orders nearby` : 'Go online to start earning'}
              </Text>
            </View>
          </View>
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

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0F0F24' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8888AA' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0D0D1F' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1B1B3A' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#25254D' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#080816' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#13132B' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1C1C3F' }] },
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  courierMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: COLORS.white,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  courierEmoji: {
    fontSize: 22,
  },
  orderMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.gold,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  topBar: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 99,
    elevation: 99,
  },
  statusContainer: {},
  statusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 8,
  },
  statusOnline: {
    backgroundColor: 'rgba(76,217,100,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(76,217,100,0.4)',
  },
  statusOffline: {
    backgroundColor: 'rgba(255,59,48,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.4)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.white,
  },
  headerLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(13,13,31,0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.2)',
  },
  headerLogoIcon: {
    fontSize: 24,
  },
  headerLogoTextContainer: {
    justifyContent: 'center',
  },
  headerLogoTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#D4AF37',
    letterSpacing: 1,
  },
  headerLogoSubtitle: {
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.white,
    letterSpacing: 0.5,
    marginTop: -2,
  },
  headerLogoSub: {
    fontSize: 8,
    fontWeight: '800',
    color: '#D4AF37',
    letterSpacing: 1.5,
    marginTop: -1,
  },
  earningsBox: {
    backgroundColor: 'rgba(30,30,53,0.85)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  earningsLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  earningsText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#D4AF37',
    marginTop: 2,
  },
  bottomInfo: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    zIndex: 99,
    elevation: 99,
  },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,30,53,0.9)',
    borderRadius: 18,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  pulseContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(76,217,100,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CD964',
  },
  waitingTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.white,
  },
  waitingSubtitle: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  orderCard: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: COLORS.card,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.25)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 100,
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  newOrderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(212,175,55,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
  },
  newOrderText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#D4AF37',
  },
  orderDetails: {
    marginBottom: 16,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  orderDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  orderInfo: {
    flex: 1,
  },
  orderLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 2,
  },
  orderRestaurant: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.white,
  },
  orderCustomer: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.white,
  },
  orderAddress: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  orderDivider: {
    width: 1,
    height: 20,
    backgroundColor: COLORS.border,
    marginLeft: 4.5,
    marginVertical: 4,
  },
  orderMeta: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  orderActions: {
    flexDirection: 'row',
    gap: 12,
  },
  declineBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#FF3B30',
  },
  declineBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
  },
  acceptBtn: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#4CD964',
  },
  acceptBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
  },
});
