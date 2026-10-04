import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, StatusBar, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addToCart, cartCount, cartSubtotal, EMPTY_CART, needsRestaurantSwitch, type ChosenOptions } from '@chisinau/shared-domain';
import { COLORS } from '../theme';
import { MenuItem, OptionGroup, Restaurant } from '../types';
import { fetchInsights, fetchMenu } from '../lib/api';
import { getCart, setCart, useCart } from '../lib/cart';
import ModifierSheet from '../components/ModifierSheet';

interface Props {
  route: any;
  navigation: any;
}

type Insights = Awaited<ReturnType<typeof fetchInsights>>;

export default function RestaurantScreen({ route, navigation }: Props) {
  const restaurant: Restaurant = route.params.restaurant;
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [groups, setGroups] = useState<Record<string, OptionGroup[]>>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [customizing, setCustomizing] = useState<MenuItem | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const cart = useCart();
  const ordering = restaurant.openNow && restaurant.acceptingOrders;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMenu(restaurant.id)
      .then(({ items, categories: cats, groups: g }) => {
        if (cancelled) return;
        setMenuItems(items);
        setCategories(cats);
        setGroups(g);
        setSelectedCategory(cats[0] ?? null);
        setLoadError(null);
      })
      .catch(() => { if (!cancelled) setLoadError('Nu am putut încărca meniul.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    fetchInsights(restaurant.id).then(i => { if (!cancelled) setInsights(i); });
    return () => { cancelled = true; };
  }, [restaurant.id, reload]);

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

      <ScrollView showsVerticalScrollIndicator={false}>
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
            {restaurant.acceptsCatering && (
              <TouchableOpacity
                style={styles.headerBtn}
                accessibilityLabel="Catering"
                onPress={() => navigation.navigate('Catering', { restaurantId: restaurant.id })}
              >
                <Ionicons name="people" size={20} color={COLORS.white} />
              </TouchableOpacity>
            )}
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
            {restaurant.nextOpening ? `Închis acum · se deschide ${restaurant.nextOpening}.` : 'Restaurantul nu primește comenzi acum.'}
          </Text>
        )}
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

        <View style={styles.menuList}>
          {loading && <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 24 }} />}
          {loadError && (
            <TouchableOpacity onPress={() => setReload(r => r + 1)}>
              <Text style={styles.closedNote}>{loadError} Atinge pentru a reîncerca.</Text>
            </TouchableOpacity>
          )}
          {filteredItems.map(item => (
            <View key={item.id} style={styles.menuItem}>
              <View style={styles.menuItemText}>
                <Text style={styles.menuItemName}>{item.name}</Text>
                <Text style={styles.menuItemDesc} numberOfLines={2}>{item.description}</Text>
                <View style={styles.menuItemBottom}>
                  <Text style={styles.menuItemPrice}>{item.priceMdl} MDL</Text>
                  {ordering && (
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
