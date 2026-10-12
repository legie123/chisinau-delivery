import React, { useState, useRef, useCallback, useMemo } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SERIF, CARD_TINTS } from '../theme';
import { LinearGradient } from 'expo-linear-gradient';
import { Restaurant } from '../types';
import { fetchCouriersAvailable, fetchRestaurants } from '../lib/api';
import { currentPosition, dismissPriming, locationPermission, primingDismissed } from '../lib/location';
import { DEFAULT_FILTER, filterRestaurants, isDefaultFilter, isStale, popularRestaurants, type BrowseFilter } from '../lib/browse';
import { useFavorites } from '../lib/favorites';
import { useCart } from '../lib/cart';
import { cartCount } from '@chisinau/shared-domain';
import BrowseFilters from '../components/BrowseFilters';
import FavoriteHeart from '../components/FavoriteHeart';
import { useOffline } from '../components/OfflineBanner';

interface Props {
  navigation: any;
}

// 'none' = no position (fast first paint), 'silent' = only if already granted, 'ask' = OS prompt.
type PositionMode = 'none' | 'silent' | 'ask';

function ratingText(r: Restaurant): string {
  return r.ratingCount > 0 && r.ratingAvg != null ? `${Number(r.ratingAvg).toFixed(1)} (${r.ratingCount})` : 'Nou';
}

function distanceText(m: number | null): string | null {
  if (m == null) return null;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function HomeScreen({ navigation }: Props) {
  const [filter, setFilter] = useState<BrowseFilter>(DEFAULT_FILTER);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [couriersFree, setCouriersFree] = useState<boolean | null>(null);
  const [priming, setPriming] = useState(false);
  const loadedAt = useRef<number | null>(null);
  const cart = useCart();
  const inCart = cartCount(cart.lines);
  const favorites = useFavorites(navigation);

  const load = useCallback(async (mode: PositionMode) => {
    try {
      const position = mode === 'none' ? null : await currentPosition(6000, mode === 'ask');
      setRestaurants(await fetchRestaurants(position));
      fetchCouriersAvailable().then(setCouriersFree).catch(() => setCouriersFree(null));
      loadedAt.current = Date.now();
      setLoadError(null);
    } catch {
      setLoadError('Nu am putut încărca restaurantele. Verifică conexiunea.');
    }
  }, []);

  const reload = useCallback(async () => {
    await load((await locationPermission()) === 'granted' ? 'silent' : 'none');
  }, [load]);

  // Open-now is computed at fetch time, so a list older than a minute is re-read when
  // the tab regains focus (back from a restaurant, from another tab, from background).
  useFocusEffect(
    useCallback(() => {
      if (!isStale(loadedAt.current, Date.now())) return;
      let cancelled = false;
      (async () => {
        if (loadedAt.current != null) return reload();
        // First load: alphabetical list first (fast), then by distance once a position exists.
        // The spinner settles even if the user left meanwhile (blur ≠ unmount: on return
        // the list is fresh, so no reload would ever clear it); only the follow-ups stop.
        try {
          await load('none');
        } finally {
          setLoading(false);
        }
        if (cancelled) return;
        const permission = await locationPermission();
        if (permission === 'granted') await load('silent');
        // Explain why before the OS prompt — the OS shows its prompt only once.
        else if (permission === 'undetermined' && !(await primingDismissed()) && !cancelled) setPriming(true);
      })();
      return () => { cancelled = true; };
    }, [load, reload]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const onRetry = async () => {
    setLoading(true);
    await reload();
    setLoading(false);
  };

  // Back online after a failed load: retry on our own instead of waiting for a tap.
  useOffline(() => { if (loadError) onRetry(); });

  const allowLocation = () => {
    setPriming(false);
    load('ask');
  };

  const notNow = () => {
    setPriming(false);
    dismissPriming();
  };

  // The object is only a preview for the first paint; RestaurantScreen re-reads the
  // restaurant by id on focus, so open/closed is never frozen in the params.
  const openRestaurant = (restaurant: Restaurant) =>
    navigation.navigate('Restaurant', { restaurantId: restaurant.id, restaurant });

  const filteredRestaurants = useMemo(() => filterRestaurants(restaurants, filter), [restaurants, filter]);
  const popular = useMemo(() => popularRestaurants(restaurants), [restaurants]);
  const noneOpen = useMemo(() => filterRestaurants(restaurants, { ...DEFAULT_FILTER, openNowOnly: true }).length === 0, [restaurants]);
  const showPopular = isDefaultFilter(filter) && popular.length > 0;
  const located = restaurants.some(r => r.distanceM != null);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
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
              value={filter.query}
              onChangeText={query => setFilter(f => ({ ...f, query }))}
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

        {priming && (
          <View style={styles.primingCard}>
            <View style={styles.primingHead}>
              <Ionicons name="location-outline" size={20} color={COLORS.gold} />
              <Text style={styles.primingTitle}>Vezi ce e aproape de tine</Text>
            </View>
            <Text style={styles.primingText}>
              Cu locația activă îți arătăm distanța până la fiecare restaurant și le punem primele pe cele mai
              apropiate. O folosim doar cât aplicația e deschisă.
            </Text>
            <View style={styles.primingActions}>
              <TouchableOpacity style={styles.primingAllow} onPress={allowLocation}>
                <Text style={styles.primingAllowText}>Permite locația</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primingLater} onPress={notNow}>
                <Text style={styles.primingLaterText}>Nu acum</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <BrowseFilters value={filter} onChange={setFilter} />

        {showPopular && (
          <View style={styles.popularSection}>
            <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>Populare</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              {popular.map(r => (
                <TouchableOpacity key={r.id} activeOpacity={0.85} onPress={() => openRestaurant(r)}>
                  <LinearGradient colors={CARD_TINTS[r.cuisine] ?? CARD_TINTS.other} style={styles.popularTile}>
                    {r.coverUrl && <Image source={{ uri: r.coverUrl }} style={styles.popularImage} />}
                    <View style={styles.popularScrim} />
                    <Text style={styles.popularName} numberOfLines={2}>{r.name}</Text>
                    <Text style={styles.popularMeta} numberOfLines={1}>★ {Number(r.ratingAvg).toFixed(1)} · {r.category}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {couriersFree === false && (
          <View style={styles.couriersBusy} accessibilityRole="alert">
            <Text style={styles.couriersBusyText}>Toți curierii sunt ocupați acum — livrarea poate întârzia.</Text>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{located ? 'Aproape de tine' : 'Restaurante'}</Text>
          {!loading && !loadError && <Text style={styles.countText}>{filteredRestaurants.length} disponibile</Text>}
        </View>

        {/* Restaurant Cards */}
        {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} />}
        {loadError && !loading && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
              <Text style={styles.retryText}>Reîncearcă</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loading && !loadError && filteredRestaurants.length === 0 && (
          <View style={styles.emptyBox}>
            {restaurants.length === 0 ? (
              <Text style={styles.emptyText}>Niciun restaurant disponibil.</Text>
            ) : filter.openNowOnly && noneOpen ? (
              <>
                <Text style={styles.emptyText}>🌙 Niciun restaurant nu e deschis acum.</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => setFilter(f => ({ ...f, openNowOnly: false }))}>
                  <Text style={styles.retryText}>Vezi toate restaurantele</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.emptyText}>Niciun rezultat pentru căutarea ta.</Text>
            )}
          </View>
        )}
        {filteredRestaurants.map(restaurant => {
          const closed = !restaurant.openNow || !restaurant.acceptingOrders;
          const outOfZone = restaurant.deliversHere === false;
          const distance = distanceText(restaurant.distanceM);
          return (
            <View key={restaurant.id}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => openRestaurant(restaurant)}>
                <LinearGradient
                  colors={CARD_TINTS[restaurant.cuisine] ?? CARD_TINTS.other}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.luxCard, (closed || outOfZone) && { opacity: 0.6 }]}
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
                      {outOfZone ? (
                        <View style={styles.feePill}>
                          <Text style={styles.feePillText}>NU LIVREAZĂ LA ADRESA TA</Text>
                        </View>
                      ) : closed ? (
                        <View style={styles.feePill}>
                          <Text style={styles.feePillText}>
                            {!restaurant.acceptingOrders
                              ? 'ÎNCHIS MOMENTAN'
                              : restaurant.nextOpening ? `ÎNCHIS · ${restaurant.nextOpening.toUpperCase()}` : 'ÎNCHIS ACUM'}
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
              {/* Sibling of the card, not a child: its tap must not also open the restaurant. */}
              <FavoriteHeart
                active={favorites.ids.has(restaurant.id)}
                onPress={() => favorites.toggle(restaurant.id)}
                style={styles.cardHeart}
              />
            </View>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cardHeart: { position: 'absolute', top: 10, right: 10 },
  countText: { fontSize: 13, color: COLORS.textSecondary },
  emptyBox: { alignItems: 'center', gap: 12, marginTop: 32 },
  emptyText: { color: COLORS.textSecondary, textAlign: 'center' },
  retryBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: COLORS.white, fontWeight: '700' },
  primingCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginTop: -8, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)' },
  primingHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  primingTitle: { color: COLORS.white, fontWeight: '800', fontSize: 15 },
  primingText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  primingActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primingAllow: { backgroundColor: COLORS.gold, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  primingAllowText: { color: '#18181b', fontWeight: '800' },
  primingLater: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  primingLaterText: { color: COLORS.textSecondary, fontWeight: '600' },
  popularSection: { marginBottom: 22 },
  popularTile: { width: 170, minHeight: 104, borderRadius: 14, padding: 12, justifyContent: 'flex-end', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(245,166,35,0.18)' },
  popularImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.45 },
  popularScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  popularName: { color: COLORS.white, fontFamily: SERIF, fontWeight: '700', fontSize: 14 },
  popularMeta: { color: COLORS.gold, fontSize: 11, fontWeight: '600', marginTop: 4 },
  luxCard: { borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(245,166,35,0.18)' },
  luxName: { fontSize: 22, fontFamily: SERIF, fontWeight: '700', color: COLORS.white },
  feePill: { alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 10 },
  feePillGold: { borderColor: 'rgba(245,166,35,0.6)' },
  feePillText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,0.7)' },
  feePillTextGold: { color: COLORS.gold },
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingHorizontal: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  logoContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoIcon: { fontSize: 36 },
  logoTitle: { fontSize: 20, fontFamily: SERIF, fontWeight: '700', color: COLORS.gold, letterSpacing: 1 },
  logoSubtitle: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.45)', letterSpacing: 3, marginTop: 1 },
  notificationBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  notificationBadge: { position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  badgeText: { fontSize: 9, fontWeight: '700', color: COLORS.white },
  tagline: { fontSize: 11, fontWeight: '600', color: COLORS.gold, letterSpacing: 3, marginBottom: 24, opacity: 0.7 },
  searchRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 14, paddingHorizontal: 16, height: 50, borderWidth: 1, borderColor: COLORS.border },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 14, color: COLORS.textPrimary },
  couriersBusy: { marginHorizontal: 20, marginBottom: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gold, backgroundColor: 'rgba(245,166,35,0.08)' },
  couriersBusyText: { color: COLORS.gold, fontSize: 13, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  cardContent: { flexDirection: 'row', padding: 16 },
  cardTextArea: { flex: 1, justifyContent: 'center', paddingRight: 12 },
  restaurantCategory: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 8 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  rating: { fontSize: 13, color: COLORS.gold, fontWeight: '600' },
  metaSeparator: { fontSize: 13, color: COLORS.textMuted, marginHorizontal: 6 },
  deliveryTime: { fontSize: 13, color: COLORS.textSecondary },
  cardImage: { width: 110, height: 110, borderRadius: 16 },
  cardImageEmpty: { backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
  shortcutRow: { flexDirection: 'row', gap: 12, marginTop: -12, marginBottom: 24 },
  shortcut: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)', backgroundColor: COLORS.surface },
  shortcutText: { color: COLORS.gold, fontWeight: '700', fontSize: 14 },
});
