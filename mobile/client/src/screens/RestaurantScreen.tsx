import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  StatusBar,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { MenuItem, CartItem } from '../types';
import { fetchMenu } from '../lib/api';

const { width } = Dimensions.get('window');


interface Props {
  route: any;
  navigation: any;
}

export default function RestaurantScreen({ route, navigation }: Props) {
  const { restaurant, imageUrl } = route.params;
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchMenu(restaurant.id)
      .then(({ items, categories: cats }) => {
        if (cancelled) return;
        setMenuItems(items);
        setCategories(cats);
        setSelectedCategory(cats[0] ?? null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [restaurant.id]);

  const filteredItems = selectedCategory
    ? menuItems.filter(i => i.category === selectedCategory)
    : menuItems;

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.menuItem.id === item.id);
      if (existing) {
        return prev.map(c => c.menuItem.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  };

  const totalItems = cart.reduce((sum, c) => sum + c.quantity, 0);
  const totalPrice = cart.reduce((sum, c) => sum + c.quantity * parseFloat(c.menuItem.price), 0);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Banner with header buttons and details overlay */}
        <View style={styles.bannerContainer}>
          <Image source={{ uri: imageUrl }} style={styles.banner} />
          <View style={styles.bannerOverlay} />

          {/* Header Action Buttons */}
          <View style={styles.bannerHeaderButtons}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-back" size={24} color={COLORS.white} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn}>
              <Ionicons name="notifications" size={20} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          {/* Branded Logo and Info Container */}
          <View style={styles.bannerInfo}>
            {/* Restaurant Logo Card with Golden Dragon Emblem */}
            <View style={styles.restaurantLogo}>
              <Text style={styles.logoEmoji}>🐉</Text>
            </View>
            <View style={styles.bannerText}>
              <Text style={styles.bannerName}>{restaurant.name}</Text>
              <Text style={styles.bannerCategory}>{restaurant.category}</Text>
              <View style={styles.bannerMeta}>
                <View style={styles.metaBadge}>
                  <Ionicons name="star" size={12} color={COLORS.gold} />
                  <Text style={styles.bannerRating}>{restaurant.rating}</Text>
                </View>
                <Text style={styles.bannerSep}>•</Text>
                <View style={styles.metaBadge}>
                  <Ionicons name="time" size={12} color="#D4AF37" />
                  <Text style={styles.bannerTime}>{restaurant.deliveryTime}</Text>
                </View>
                <Text style={styles.bannerSep}>•</Text>
                <View style={[styles.metaBadge, styles.freeDeliveryBadge]}>
                  <Text style={styles.bannerFree}>
                    {restaurant.deliveryFee === '0' ? 'LIVRARE GRATUITĂ' : `Livrare ${restaurant.deliveryFee} MDL`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Categories Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesRow}
        >
          {categories.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.categoryPill, selectedCategory === cat && styles.categoryPillActive]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text style={[styles.categoryText, selectedCategory === cat && styles.categoryTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Menu Items Cards */}
        <View style={styles.menuList}>
          {loading && <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 24 }} />}
          {filteredItems.map(item => (
            <View key={item.id} style={styles.menuItem}>
              <View style={styles.menuItemText}>
                <Text style={styles.menuItemName}>{item.name}</Text>
                <Text style={styles.menuItemDesc} numberOfLines={2}>{item.description}</Text>
                <View style={styles.menuItemBottom}>
                  <Text style={styles.menuItemPrice}>{item.price} MDL</Text>
                  <TouchableOpacity style={styles.addBtn} onPress={() => addToCart(item)}>
                    <Text style={styles.addBtnText}>Add +</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Image source={{ uri: item.imageUrl ?? imageUrl }} style={styles.menuItemImage} />
            </View>
          ))}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Floating Bottom Cart Bar */}
      {totalItems > 0 && (
        <TouchableOpacity
          style={styles.cartBar}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('Cart', { cart, restaurant })}
        >
          <View style={styles.cartLeft}>
            <View style={styles.cartBadgeContainer}>
              <View style={styles.cartBadgeCircle}>
                <Ionicons name="bag-handle" size={20} color={COLORS.white} />
              </View>
              <View style={styles.cartCountBadge}>
                <Text style={styles.cartCountText}>{totalItems}</Text>
              </View>
            </View>
            <Text style={styles.cartText}>{totalItems} items · {totalPrice} MDL</Text>
          </View>
          <View style={styles.cartRight}>
            <Text style={styles.cartAction}>View Cart</Text>
            <Ionicons name="arrow-forward-circle" size={24} color={COLORS.white} />
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  bannerContainer: {
    height: 250,
    position: 'relative',
  },
  banner: {
    width: '100%',
    height: '100%',
  },
  bannerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(13,13,31,0.7)',
  },
  bannerHeaderButtons: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 99,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(13,13,31,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bannerInfo: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  restaurantLogo: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#0D0D1F',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    marginRight: 14,
    shadowColor: '#D4AF37',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  logoEmoji: {
    fontSize: 32,
  },
  bannerText: {
    flex: 1,
  },
  bannerName: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.white,
    letterSpacing: 0.5,
  },
  bannerCategory: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bannerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  freeDeliveryBadge: {
    backgroundColor: 'rgba(76,217,100,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(76,217,100,0.25)',
  },
  bannerRating: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.gold,
  },
  bannerTime: {
    fontSize: 11,
    fontWeight: '800',
    color: '#D4AF37',
  },
  bannerFree: {
    fontSize: 9,
    fontWeight: '900',
    color: '#4CD964',
    letterSpacing: 0.5,
  },
  bannerSep: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.2)',
  },
  categoriesRow: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    gap: 6,
  },
  categoryPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryEmoji: {
    fontSize: 14,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  categoryTextActive: {
    color: COLORS.white,
    fontWeight: '800',
  },
  menuList: {
    paddingHorizontal: 16,
    gap: 14,
  },
  menuItem: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    gap: 12,
  },
  menuItemText: {
    flex: 1,
    justifyContent: 'space-between',
  },
  menuItemName: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.white,
  },
  menuItemDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  menuItemBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  menuItemPrice: {
    fontSize: 15,
    fontWeight: '900',
    color: COLORS.white,
  },
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(233,69,96,0.05)',
  },
  addBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.primary,
  },
  menuItemImage: {
    width: 90,
    height: 90,
    borderRadius: 16,
  },
  cartBar: {
    position: 'absolute',
    bottom: 25,
    left: 16,
    right: 16,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 18,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 99,
  },
  cartLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cartBadgeContainer: {
    position: 'relative',
    width: 44,
    height: 44,
  },
  cartBadgeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartCountBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  cartCountText: {
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.primary,
  },
  cartText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.white,
  },
  cartRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cartAction: {
    fontSize: 13,
    fontWeight: '900',
    color: COLORS.white,
  },
});
