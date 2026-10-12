import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, StatusBar, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { addToCart, cartCount, cartSubtotal, EMPTY_CART, needsRestaurantSwitch, type ChosenOptions } from '@chisinau/shared-domain';
import { COLORS } from '../theme';
import { MenuItem, OptionGroup, Restaurant } from '../types';
import { fetchInsights, fetchMenu, fetchRestaurants, fetchCouriersAvailable } from '../lib/api';
import { isOpenForOrders } from '../lib/browse';
import { useFavorites } from '../lib/favorites';
import { getCart, setCart, useCart } from '../lib/cart';
import ModifierSheet from '../components/ModifierSheet';
import FavoriteHeart from '../components/FavoriteHeart';

// Params: `restaurantId` (required by new callers), `restaurant` (optional preview for the
// first paint — older callers pass only this), `itemId` (dish search: scroll to + highlight).
type Params = { restaurantId?: string; restaurant?: Restaurant; itemId?: string };
interface Props {
  route: any;
  navigation: any;
}

type Insights = Awaited<ReturnType<typeof fetchInsights>>;

export default function RestaurantScreen({ route, navigation }: Props) {
  const params: Params = route.params ?? {};
  const preview = params.restaurant ?? null;
  const restaurantId = params.restaurantId ?? preview?.id ?? '';
  const targetItemId = params.itemId ?? null;
  const [restaurant, setRestaurant] = useState<Restaurant | null>(preview);
  const [missing, setMissing] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [groups, setGroups] = useState<Record<string, OptionGroup[]>>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [customizing, setCustomizing] = useState<MenuItem | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [menuY, setMenuY] = useState<number | null>(null);
  const [targetY, setTargetY] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrolledToTarget = useRef(false);
  const cart = useCart();
  const favorites = useFavorites(navigation);

  // Open/closed is re-read on every focus, never trusted from the params: a screen left
  // open across closing time (or reached from a stale list) must stop offering "Adaugă".
  // ponytail: re-reads the whole (small, ~dozen rows) list to reuse fetchRestaurants'
  // hours/estimate mapping; add a by-id read to api.ts if the list grows large.
  const [couriersFree, setCouriersFree] = useState<boolean | null>(null);
  useFocusEffect(useCallback(() => { fetchCouriersAvailable().then(setCouriersFree).catch(() => setCouriersFree(null)); }, []));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchRestaurants()
        .then(list => {
          if (cancelled) return;
          const fresh = list.find(r => r.id === restaurantId);
          if (!fresh) return setMissing(true);
          setMissing(false);
          setRestaurant(prev => ({ ...fresh, distanceM: fresh.distanceM ?? prev?.distanceM ?? null }));
        })
        .catch(() => { /* offline: keep the preview; place_order still re-checks the hours */ });
      return () => { cancelled = true; };
    }, [restaurantId]),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMenu(restaurantId)
      .then(({ items, categories: cats, groups: g }) => {
        if (cancelled) return;
        setMenuItems(items);
        setCategories(cats);
        setGroups(g);
        const target = targetItemId ? items.find(i => i.id === targetItemId) : undefined;
        setSelectedCategory(target?.category ?? cats[0] ?? null);
        setLoadError(null);
      })
      .catch(() => { if (!cancelled) setLoadError('Nu am putut încărca meniul.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    fetchInsights(restaurantId).then(i => { if (!cancelled) setInsights(i); }).catch(() => {});
    return () => { cancelled = true; };
  }, [restaurantId, targetItemId, reload]);

  // Dish-search deep link (web: ?item=): once the menu has settled, scroll the dish into
  // view and outline it briefly. Debounced: layout shifts while the spinner goes away.
  useEffect(() => {
    if (!targetItemId || scrolledToTarget.current || loading || menuY == null || targetY == null) return;
    const t = setTimeout(() => {
      scrolledToTarget.current = true;
      scrollRef.current?.scrollTo({ y: Math.max(0, menuY + targetY - 140), animated: true });
      setHighlightId(targetItemId);
    }, 250);
    return () => clearTimeout(t);
  }, [targetItemId, loading, menuY, targetY]);

  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 2400);
    return () => clearTimeout(t);
  }, [highlightId]);

  if (!restaurant) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        {missing ? (
          <>
            <Text style={styles.closedNote}>Restaurantul nu mai este disponibil.</Text>
            <TouchableOpacity style={styles.backPlain} onPress={() => navigation.goBack()}>
              <Text style={styles.backPlainText}>Înapoi</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ActivityIndicator color={COLORS.primary} />
        )}
      </View>
    );
  }

  const ordering = isOpenForOrders(restaurant) && !missing;
  const filteredItems = selectedCategory ? menuItems.filter(i => i.category === selectedCategory) : menuItems;

  const commitAdd = (item: MenuItem, options?: ChosenOptions, quantity = 1) => {
    const ref = { id: item.id, name: item.name, price_mdl: item.priceMdl };
    const target = { id: restaurant.id, name: restaurant.name };
    if (needsRestaurantSwitch(getCart(), restaurant.id)) {
      Alert.alert(
        'Coș nou?',
        `Coșul are produse de la ${getCart().restaurantName}. Golești coșul și începi unul nou de la ${restaurant.name}?`,
        [
          { text: 'Renunță', style: 'cancel' },
          { text: 'Coș nou', style: 'destructive', onPress: () => setCart(addToCart(EMPTY_CART, target, ref, options, quantity)) },
        ],
      );
      return;
    }
    setCart(prev => addToCart(prev, target, ref, options, quantity));
  };

  const onAddPress = (item: MenuItem) => {
    if ((groups[item.id] ?? []).length > 0) setCustomizing(item);
    else commitAdd(item);
  };

  const ownCart = cart.restaurantId === restaurant.id;
  const totalItems = ownCart ? cartCount(cart.lines) : 0;
  const totalPrice = ownCart ? cartSubtotal(cart.lines) : 0;
  const breakdown = insights?.breakdown ?? [];
  const totalRatings = breakdown[0]?.total_ratings ?? 0;
  const busiest = (insights?.hours ?? []).filter(h => h.intensity_pct >= 70).map(h => `${h.hour_of_day}:00`);
  const hasRating = restaurant.ratingCount > 0 && restaurant.ratingAvg != null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}>
        <View style={styles.bannerContainer}>
          {restaurant.coverUrl ? (
            <Image source={{ uri: restaurant.coverUrl }} style={styles.banner} />
          ) : (
            <View style={[styles.banner, { backgroundColor: COLORS.surface }]} />
          )}
          <View style={styles.bannerOverlay} />

          <View style={styles.bannerHeaderButtons}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.goBack()} accessibilityLabel="Înapoi">
              <Ionicons name="chevron-back" size={24} color={COLORS.white} />
            </TouchableOpacity>
            <View style={styles.headerRight}>
              {restaurant.acceptsCatering && (
                <TouchableOpacity
                  style={styles.headerBtn}
                  accessibilityLabel="Catering"
                  onPress={() => navigation.navigate('Catering', { restaurantId: restaurant.id })}
                >
                  <Ionicons name="people" size={20} color={COLORS.white} />
                </TouchableOpacity>
              )}
              <FavoriteHeart active={favorites.ids.has(restaurant.id)} onPress={() => favorites.toggle(restaurant.id)} />
            </View>
          </View>

          <View style={styles.bannerInfo}>
            <View style={styles.restaurantLogo}>
              {restaurant.logoUrl ? (
                <Image source={{ uri: restaurant.logoUrl }} style={styles.logoImage} />
              ) : (
                <Text style={styles.logoEmoji}>🐉</Text>
              )}
            </View>
            <View style={styles.bannerText}>
              <Text style={styles.bannerName}>{restaurant.name}</Text>
              <Text style={styles.bannerCategory}>{restaurant.category}</Text>
              <View style={styles.bannerMeta}>
                <View style={styles.metaBadge}>
                  <Ionicons name="star" size={12} color={COLORS.gold} />
                  <Text style={styles.bannerRating}>{hasRating ? Number(restaurant.ratingAvg).toFixed(1) : 'Nou'}</Text>
                </View>
                <View style={styles.metaBadge}>
                  <Ionicons name="time" size={12} color="#D4AF37" />
                  <Text style={styles.bannerTime}>{restaurant.prepLabel}</Text>
                </View>
                <View style={[styles.metaBadge, styles.freeDeliveryBadge]}>
                  <Text style={styles.bannerFree}>
                    {restaurant.deliveryFee === 0 ? 'LIVRARE GRATUITĂ' : `Livrare ${restaurant.deliveryFee} MDL`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {!ordering && (
          <Text style={styles.closedNote}>
            {missing
              ? 'Restaurantul nu mai este disponibil.'
              : !restaurant.acceptingOrders
                ? 'Restaurantul nu primește comenzi momentan.'
                : restaurant.nextOpening ? `Închis acum · se deschide ${restaurant.nextOpening}.` : 'Restaurantul nu primește comenzi acum.'}
          </Text>
        )}
        {restaurant.deliversHere === false && (
          <Text style={styles.closedNote}>Nu livrează la adresa ta salvată — poți comanda la altă adresă din coș.</Text>
        )}
        {couriersFree === false && <Text style={styles.closedNote}>Toți curierii sunt ocupați acum — livrarea poate întârzia.</Text>}
        {restaurant.minOrder > 0 && <Text style={styles.minNote}>Comandă minimă {restaurant.minOrder} MDL</Text>}

        {totalRatings > 0 && (
          <View style={styles.insights}>
            {[...breakdown].sort((a, b) => b.stars - a.stars).map(b => (
              <View key={b.stars} style={styles.starRow}>
                <Text style={styles.starLabel}>{b.stars}★</Text>
                <View style={styles.starTrack}>
                  <View style={[styles.starFill, { width: `${Math.round((b.rating_count / totalRatings) * 100)}%` }]} />
                </View>
                <Text style={styles.starCount}>{b.rating_count}</Text>
              </View>
            ))}
          </View>
        )}
        {busiest.length > 0 && <Text style={styles.minNote}>Ore aglomerate: {busiest.join(', ')}</Text>}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesRow}>
          {categories.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.categoryPill, selectedCategory === cat && styles.categoryPillActive]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text style={[styles.categoryText, selectedCategory === cat && styles.categoryTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.menuList} onLayout={e => setMenuY(e.nativeEvent.layout.y)}>
          {loading && <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 24 }} />}
          {loadError && (
            <TouchableOpacity onPress={() => setReload(r => r + 1)}>
              <Text style={styles.closedNote}>{loadError} Atinge pentru a reîncerca.</Text>
            </TouchableOpacity>
          )}
          {filteredItems.map(item => (
            <View
              key={item.id}
              style={[styles.menuItem, highlightId === item.id && styles.menuItemHighlight, item.soldOut && styles.menuItemSoldOut]}
              onLayout={item.id === targetItemId ? e => setTargetY(e.nativeEvent.layout.y) : undefined}
            >
              <View style={styles.menuItemText}>
                <Text style={styles.menuItemName}>{item.name}</Text>
                <Text style={styles.menuItemDesc} numberOfLines={2}>{item.description}</Text>
                <View style={styles.menuItemBottom}>
                  <Text style={styles.menuItemPrice}>{item.priceMdl} MDL</Text>
                  {item.soldOut ? (
                    <Text style={styles.soldOutBadge} accessibilityLabel={`${item.name}: epuizat`}>Epuizat</Text>
                  ) : ordering && (
                    <TouchableOpacity style={styles.addBtn} onPress={() => onAddPress(item)}>
                      <Text style={styles.addBtnText}>{(groups[item.id] ?? []).length > 0 ? 'Alege +' : 'Adaugă +'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              {item.imageUrl && <Image source={{ uri: item.imageUrl }} style={styles.menuItemImage} />}
            </View>
          ))}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {customizing && (
        <ModifierSheet
          item={customizing}
          groups={groups[customizing.id] ?? []}
          onClose={() => setCustomizing(null)}
          onAdd={(options, qty) => {
            const item = customizing;
            setCustomizing(null);
            commitAdd(item, options, qty);
          }}
        />
      )}

      {totalItems > 0 && (
        <TouchableOpacity style={styles.cartBar} activeOpacity={0.9} onPress={() => navigation.navigate('Cart')}>
          <View style={styles.cartLeft}>
            <View style={styles.cartBadgeContainer}>
              <View style={styles.cartBadgeCircle}>
                <Ionicons name="bag-handle" size={20} color={COLORS.white} />
              </View>
              <View style={styles.cartCountBadge}>
                <Text style={styles.cartCountText}>{totalItems}</Text>
              </View>
            </View>
            <Text style={styles.cartText}>{totalItems} produse · {totalPrice.toFixed(2)} MDL</Text>
          </View>
          <View style={styles.cartRight}>
            <Text style={styles.cartAction}>Vezi coșul</Text>
            <Ionicons name="arrow-forward-circle" size={24} color={COLORS.white} />
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  backPlain: { marginTop: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  backPlainText: { color: COLORS.white, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuItemHighlight: { borderColor: COLORS.gold, borderWidth: 2 },
  container: { flex: 1, backgroundColor: COLORS.background },
  bannerContainer: { height: 250, position: 'relative' },
  banner: { width: '100%', height: '100%' },
  bannerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(13,13,31,0.7)' },
  bannerHeaderButtons: { position: 'absolute', top: 50, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 99 },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(13,13,31,0.6)', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  bannerInfo: { position: 'absolute', bottom: 20, left: 16, right: 16, flexDirection: 'row', alignItems: 'center' },
  restaurantLogo: {
    width: 60, height: 60, borderRadius: 16, backgroundColor: '#0D0D1F', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#D4AF37', marginRight: 14, elevation: 4,
  },
  logoImage: { width: 56, height: 56, borderRadius: 14 },
  logoEmoji: { fontSize: 32 },
  bannerText: { flex: 1 },
  bannerName: { fontSize: 22, fontWeight: '900', color: COLORS.white, letterSpacing: 0.5 },
  bannerCategory: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  bannerMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' },
  metaBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 },
  freeDeliveryBadge: { backgroundColor: 'rgba(76,217,100,0.15)', borderWidth: 1, borderColor: 'rgba(76,217,100,0.25)' },
  bannerRating: { fontSize: 11, fontWeight: '800', color: COLORS.gold },
  bannerTime: { fontSize: 11, fontWeight: '800', color: '#D4AF37' },
  bannerFree: { fontSize: 9, fontWeight: '900', color: '#4CD964', letterSpacing: 0.5 },
  closedNote: { color: COLORS.warning, textAlign: 'center', marginTop: 14, marginHorizontal: 16, fontWeight: '600' },
  minNote: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, fontSize: 12 },
  insights: { marginHorizontal: 16, marginTop: 14, gap: 4 },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  starLabel: { color: COLORS.gold, fontSize: 11, width: 24 },
  starTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  starFill: { height: 6, backgroundColor: COLORS.gold },
  starCount: { color: COLORS.textMuted, fontSize: 11, width: 28, textAlign: 'right' },
  categoriesRow: { paddingHorizontal: 16, paddingVertical: 16, gap: 10 },
  categoryPill: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', gap: 6,
  },
  categoryPillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  categoryText: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary },
  categoryTextActive: { color: COLORS.white, fontWeight: '800' },
  menuList: { paddingHorizontal: 16, gap: 14 },
  menuItem: {
    flexDirection: 'row', backgroundColor: COLORS.card, borderRadius: 20, padding: 16, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)', gap: 12,
  },
  menuItemText: { flex: 1, justifyContent: 'space-between' },
  menuItemName: { fontSize: 15, fontWeight: '800', color: COLORS.white },
  menuItemDesc: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4, lineHeight: 16 },
  menuItemBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  menuItemPrice: { fontSize: 15, fontWeight: '900', color: COLORS.white },
  menuItemSoldOut: { opacity: 0.45 },
  soldOutBadge: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  addBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: 'rgba(233,69,96,0.05)' },
  addBtnText: { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  menuItemImage: { width: 90, height: 90, borderRadius: 16 },
  cartBar: {
    position: 'absolute', bottom: 25, left: 16, right: 16, height: 64, borderRadius: 32, backgroundColor: COLORS.primary,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 10, paddingRight: 18, elevation: 8, zIndex: 99,
  },
  cartLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cartBadgeContainer: { position: 'relative', width: 44, height: 44 },
  cartBadgeCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  cartCountBadge: {
    position: 'absolute', top: -2, right: -2, backgroundColor: COLORS.white, borderRadius: 10, minWidth: 18, height: 18,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4,
  },
  cartCountText: { fontSize: 10, fontWeight: '900', color: COLORS.primary },
  cartText: { fontSize: 13, fontWeight: '800', color: COLORS.white },
  cartRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cartAction: { fontSize: 13, fontWeight: '900', color: COLORS.white },
});
