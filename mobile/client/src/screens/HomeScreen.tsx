import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SERIF, CARD_TINTS } from '../theme';
import { LinearGradient } from 'expo-linear-gradient';
import { Restaurant } from '../types';
import { fetchRestaurants } from '../lib/api';
import { currentPosition } from '../lib/location';
import { useCart } from '../lib/cart';
import { cartCount } from '@chisinau/shared-domain';

interface Props {
  navigation: any;
}

function ratingText(r: Restaurant): string {
  return r.ratingCount > 0 && r.ratingAvg != null ? `${Number(r.ratingAvg).toFixed(1)} (${r.ratingCount})` : 'Nou';
}

function distanceText(m: number | null): string | null {
  if (m == null) return null;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function HomeScreen({ navigation }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cart = useCart();
  const inCart = cartCount(cart.lines);

  const load = async (withPosition: boolean) => {
    try {
      const position = withPosition ? await currentPosition() : null;
      setRestaurants(await fetchRestaurants(position));
      setLoadError(null);
    } catch {
      setLoadError('Nu am putut încărca restaurantele. Verifică conexiunea.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    // Alphabetical list first (fast), then re-sorted by distance once a position exists.
    load(false).finally(() => {
      if (cancelled) return;
      setLoading(false);
      load(true);
    });
    return () => { cancelled = true; };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredRestaurants = restaurants.filter(r =>
    !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {/* Header / Logo */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoIcon}>🐉</Text>
            <View>
              <Text style={styles.logoTitle}>DRAGONS DELIVERY</Text>
              <Text style={styles.logoSubtitle}>CHIȘINĂU · PREMIUM</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.notificationBtn}
            accessibilityLabel="Coșul meu"
            onPress={() => navigation.navigate('Cart')}
          >
            <Ionicons name="bag-handle-outline" size={22} color={COLORS.white} />
            {inCart > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.badgeText}>{inCart}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.tagline}>LIVRARE · CATERING · CONCIERGE</Text>

        {/* Search Bar */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Caută un restaurant..."
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        <View style={styles.shortcutRow}>
          <TouchableOpacity style={styles.shortcut} onPress={() => navigation.navigate('Catering')}>
            <Ionicons name="people-outline" size={18} color={COLORS.gold} />
            <Text style={styles.shortcutText}>Catering</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shortcut} onPress={() => navigation.navigate('Concierge')}>
            <Ionicons name="key-outline" size={18} color={COLORS.gold} />
            <Text style={styles.shortcutText}>Concierge</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Restaurante</Text>
        </View>

        {/* Restaurant Cards */}
        {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} />}
        {loadError && <Text style={{ color: COLORS.textSecondary, textAlign: 'center', marginTop: 32 }}>{loadError}</Text>}
        {!loading && !loadError && filteredRestaurants.length === 0 && (
          <Text style={{ color: COLORS.textSecondary, textAlign: 'center', marginTop: 32 }}>Niciun restaurant disponibil.</Text>
        )}
        {filteredRestaurants.map(restaurant => {
          const closed = !restaurant.openNow || !restaurant.acceptingOrders;
          const distance = distanceText(restaurant.distanceM);
          return (
            <TouchableOpacity
              key={restaurant.id}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Restaurant', { restaurant })}
            >
              <LinearGradient
                colors={CARD_TINTS[restaurant.cuisine] ?? CARD_TINTS.other}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.luxCard, closed && { opacity: 0.6 }]}
              >
                <View style={styles.cardContent}>
                  <View style={styles.cardTextArea}>
                    <Text style={styles.luxName}>{restaurant.name}</Text>
                    <Text style={styles.restaurantCategory}>{restaurant.category}{distance ? ` · ${distance}` : ''}</Text>
                    <View style={styles.cardMeta}>
                      <Text style={styles.rating}>★ {ratingText(restaurant)}</Text>
                      <Text style={styles.metaSeparator}>·</Text>
                      <Text style={styles.deliveryTime}>{restaurant.prepLabel}</Text>
                    </View>
                    {closed ? (
                      <View style={styles.feePill}>
                        <Text style={styles.feePillText}>
                          {restaurant.nextOpening ? `ÎNCHIS · ${restaurant.nextOpening.toUpperCase()}` : 'ÎNCHIS ACUM'}
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.feePill, restaurant.deliveryFee === 0 && styles.feePillGold]}>
                        <Text style={[styles.feePillText, restaurant.deliveryFee === 0 && styles.feePillTextGold]}>
                          {restaurant.deliveryFee === 0 ? 'LIVRARE GRATUITĂ' : `LIVRARE ${restaurant.deliveryFee} MDL`}
                        </Text>
                      </View>
                    )}
                  </View>
                  {restaurant.coverUrl ? (
                    <Image source={{ uri: restaurant.coverUrl }} style={styles.cardImage} />
                  ) : (
                    <View style={[styles.cardImage, styles.cardImageEmpty]}>
                      <Text style={{ fontSize: 40 }}>🍣</Text>
                    </View>
                  )}
                </View>
              </LinearGradient>
            </TouchableOpacity>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  luxCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.18)',
  },
  luxName: {
    fontSize: 22,
    fontFamily: SERIF,
    fontWeight: '700',
    color: COLORS.white,
  },
  feePill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 10,
  },
  feePillGold: {
    borderColor: 'rgba(245,166,35,0.6)',
  },
  feePillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.7)',
  },
  feePillTextGold: {
    color: COLORS.gold,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    fontSize: 36,
  },
  logoTitle: {
    fontSize: 20,
    fontFamily: SERIF,
    fontWeight: '700',
    color: COLORS.gold,
    letterSpacing: 1,
  },
  logoSubtitle: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 3,
    marginTop: 1,
  },
  notificationBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  notificationBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.white,
  },
  tagline: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.gold,
    letterSpacing: 3,
    marginBottom: 24,
    opacity: 0.7,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 50,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  filterBtn: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  viewAll: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  restaurantCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  cardContent: {
    flexDirection: 'row',
    padding: 16,
  },
  cardTextArea: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 12,
  },
  restaurantName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  restaurantCategory: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rating: {
    fontSize: 13,
    color: COLORS.gold,
    fontWeight: '600',
  },
  metaSeparator: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginHorizontal: 6,
  },
  deliveryTime: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  freeDeliveryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.primary + '60',
    backgroundColor: COLORS.primary + '15',
  },
  freeDeliveryText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  cardImage: {
    width: 110,
    height: 110,
    borderRadius: 16,
  },
  cardImageEmpty: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shortcutRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: -12,
    marginBottom: 24,
  },
  shortcut: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    backgroundColor: COLORS.surface,
  },
  shortcutText: {
    color: COLORS.gold,
    fontWeight: '700',
    fontSize: 14,
  },
});
