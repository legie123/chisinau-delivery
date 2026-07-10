import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
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

const { width } = Dimensions.get('window');
const SWIPE_THRESHOLD = width * 0.55;

interface Props {
  route: any;
  navigation: any;
}

export default function ActiveDeliveryScreen({ route, navigation }: Props) {
  const { order } = route.params;
  const [status, setStatus] = useState<'pickup' | 'delivering' | 'delivered'>('pickup');
  const swipeX = useRef(new Animated.Value(0)).current;

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
        Animated.spring(swipeX, { toValue: SWIPE_THRESHOLD, useNativeDriver: true }).start(() => {
          if (status === 'pickup') {
            setStatus('delivering');
            swipeX.setValue(0);
          } else if (status === 'delivering') {
            setStatus('delivered');
            Alert.alert(
              '✅ Delivery Confirmed!',
              `You have successfully completed the delivery. Earnings: ${order.earnings}`,
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
          }
        });
      } else {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  });

  const routeCoords = [
    { latitude: 44.4340, longitude: 26.0990 }, // courier
    { latitude: order.lat, longitude: order.lng }, // pickup
    { latitude: order.lat + 0.008, longitude: order.lng + 0.005 }, // delivery
  ];

  const getSwipeText = () => {
    if (status === 'pickup') return 'Swipe to confirm pickup →';
    return 'Swipe to confirm delivery →';
  };

  const getStatusSteps = () => [
    { label: 'Picked up', done: status === 'delivering' || status === 'delivered' },
    { label: 'In transit', done: status === 'delivering' || status === 'delivered' },
    { label: 'Delivered', done: status === 'delivered' },
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
          Delivering to: {order.deliveryAddress}
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
            <View style={styles.actionButtons}>
              <TouchableOpacity style={styles.chatBtn}>
                <Ionicons name="chatbubble-ellipses" size={18} color={COLORS.white} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.phoneCallOutlineBtn}
                onPress={() => Linking.openURL('tel:+40721000000')}
              >
                <Ionicons name="call" size={16} color="#4CD964" />
                <Text style={styles.phoneCallOutlineText}>Call</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Order Items with Watermark */}
          <View style={styles.itemsSection}>
            <View style={styles.itemsHeader}>
              <Text style={styles.itemsTitle}>Order Items</Text>
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
                {status === 'pickup' ? 'PICKUP ADDRESS' : 'DELIVERY ADDRESS'}
              </Text>
              <Text style={styles.addressText}>
                {status === 'pickup' ? order.pickupAddress : order.deliveryAddress}
              </Text>
            </View>
          </View>

          <View style={styles.phoneSection}>
            <Ionicons name="call" size={20} color={COLORS.gold} />
            <View style={styles.phoneInfo}>
              <Text style={styles.phoneLabel}>CUSTOMER PHONE</Text>
              <Text style={styles.phoneText}>+40 721 000 000</Text>
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
    height: '42%',
  },
  header: {
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
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(30,30,53,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
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
  notificationBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#FF3B30',
    borderRadius: 9,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#1E1E35',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.white,
  },
  addressBanner: {
    position: 'absolute',
    top: 110,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,30,53,0.9)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    zIndex: 99,
    elevation: 99,
  },
  addressBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.white,
    flex: 1,
  },
  courierMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  pointMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  bottomSheet: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -28,
    paddingHorizontal: 20,
    paddingTop: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    zIndex: 98,
    elevation: 5,
  },
  statusSteps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    paddingHorizontal: 12,
  },
  stepRow: {
    alignItems: 'center',
    flex: 1,
    position: 'relative',
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 2,
    borderColor: COLORS.border,
    zIndex: 2,
  },
  stepDotDone: {
    backgroundColor: '#D4AF37',
    borderColor: '#D4AF37',
  },
  stepLine: {
    position: 'absolute',
    top: 5,
    left: '50%',
    width: '100%',
    height: 2,
    backgroundColor: COLORS.border,
    zIndex: 1,
  },
  stepLineDone: {
    backgroundColor: '#D4AF37',
  },
  stepLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  stepLabelDone: {
    color: '#D4AF37',
    fontWeight: '800',
  },
  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  customerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(233,69,96,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
  },
  customerInfo: {
    flex: 1,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.white,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  ratingText: {
    fontSize: 11,
    color: COLORS.gold,
    fontWeight: '700',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  phoneCallOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76,217,100,0.4)',
    backgroundColor: 'rgba(76,217,100,0.08)',
  },
  phoneCallOutlineText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4CD964',
  },
  itemsSection: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    position: 'relative',
    overflow: 'hidden',
  },
  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  itemsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  watermarkContainer: {
    position: 'absolute',
    right: -10,
    bottom: -20,
    opacity: 0.08,
  },
  watermarkIcon: {
    fontSize: 60,
  },
  itemsList: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
    lineHeight: 20,
  },
  addressSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    gap: 12,
  },
  addressInfo: {
    flex: 1,
  },
  addressLabel: {
    fontSize: 9,
    fontWeight: '850',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  addressText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.white,
    lineHeight: 18,
  },
  phoneSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    gap: 12,
  },
  phoneInfo: {
    flex: 1,
  },
  phoneLabel: {
    fontSize: 9,
    fontWeight: '850',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  phoneText: {
    fontSize: 13,
    fontWeight: '750',
    color: COLORS.white,
  },
  swipeContainer: {
    position: 'absolute',
    bottom: 25,
    left: 20,
    right: 20,
    zIndex: 99,
  },
  swipeTrack: {
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  swipeThumb: {
    position: 'absolute',
    left: 4,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#4CD964',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4CD964',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
  swipeIconWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeIconText: {
    fontSize: 20,
  },
  swipeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#D4AF37',
    letterSpacing: 0.5,
  },
});
