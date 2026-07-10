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
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { Restaurant } from '../types';

const { width } = Dimensions.get('window');

// Mock data for restaurants (same as backend seed)
const MOCK_RESTAURANTS: Restaurant[] = [
  {
    id: 1, name: "Dragon's Wok", address: "Str. Calea Victoriei 25, București",
    lat: "44.4396", lng: "26.0963", phone: "+40721000001", logoUrl: null,
    coverUrl: null, category: "Pan-Asian Cuisine", rating: "4.8",
    deliveryTime: "30-40 min", deliveryFee: "0", isOpen: 1, createdAt: Date.now(),
  },
  {
    id: 2, name: "Casa Românească", address: "Str. Lipscani 12, București",
    lat: "44.4312", lng: "26.0979", phone: "+40721000002", logoUrl: null,
    coverUrl: null, category: "Traditional Romanian", rating: "4.7",
    deliveryTime: "35-45 min", deliveryFee: "5.99", isOpen: 1, createdAt: Date.now(),
  },
  {
    id: 3, name: "Sushi Dragon", address: "Bd. Unirii 45, București",
    lat: "44.4268", lng: "26.1025", phone: "+40721000003", logoUrl: null,
    coverUrl: null, category: "Sushi · Japanese", rating: "4.9",
    deliveryTime: "25-35 min", deliveryFee: "0", isOpen: 1, createdAt: Date.now(),
  },
  {
    id: 4, name: "Pizza Inferno", address: "Str. Dorobanți 88, București",
    lat: "44.4520", lng: "26.0850", phone: "+40721000004", logoUrl: null,
    coverUrl: null, category: "Pizza · Italian", rating: "4.6",
    deliveryTime: "20-30 min", deliveryFee: "7.99", isOpen: 1, createdAt: Date.now(),
  },
  {
    id: 5, name: "Burger Palace", address: "Calea Moșilor 84, București",
    lat: "44.4380", lng: "26.1100", phone: "+40721000005", logoUrl: null,
    coverUrl: null, category: "Burgers · American", rating: "4.5",
    deliveryTime: "15-25 min", deliveryFee: "4.99", isOpen: 1, createdAt: Date.now(),
  },
];

const FOOD_IMAGES = [
  'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=300&fit=crop',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=300&fit=crop',
  'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=400&h=300&fit=crop',
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&h=300&fit=crop',
  'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=300&fit=crop',
];

interface Props {
  navigation: any;
}

export default function HomeScreen({ navigation }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [restaurants, setRestaurants] = useState<Restaurant[]>(MOCK_RESTAURANTS);

  const filteredRestaurants = restaurants.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Header / Logo */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoIcon}>🐉</Text>
            <View>
              <Text style={styles.logoTitle}>DRAGONS</Text>
              <Text style={styles.logoSubtitle}>COURIERS</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.notificationBtn}>
            <Ionicons name="notifications-outline" size={22} color={COLORS.white} />
            <View style={styles.notificationBadge}>
              <Text style={styles.badgeText}>3</Text>
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.tagline}>PREMIUM FOOD DELIVERY</Text>

        {/* Search Bar */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search for restaurants or dishes..."
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <TouchableOpacity style={styles.filterBtn}>
            <Ionicons name="options-outline" size={20} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {/* Featured Restaurants */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Featured Restaurants</Text>
          <TouchableOpacity>
            <Text style={styles.viewAll}>View all {'>'}</Text>
          </TouchableOpacity>
        </View>

        {/* Restaurant Cards */}
        {filteredRestaurants.map((restaurant, index) => (
          <TouchableOpacity
            key={restaurant.id}
            style={styles.restaurantCard}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Restaurant', { restaurant, imageUrl: FOOD_IMAGES[index % FOOD_IMAGES.length] })}
          >
            <View style={styles.cardContent}>
              <View style={styles.cardTextArea}>
                <Text style={styles.restaurantName}>{restaurant.name}</Text>
                <Text style={styles.restaurantCategory}>{restaurant.category}</Text>
                <View style={styles.cardMeta}>
                  <Text style={styles.rating}>⭐ {restaurant.rating}</Text>
                  <Text style={styles.metaSeparator}>·</Text>
                  <Text style={styles.deliveryTime}>{restaurant.deliveryTime}</Text>
                </View>
                {restaurant.deliveryFee === '0' && (
                  <View style={styles.freeDeliveryBadge}>
                    <Text style={styles.freeDeliveryText}>FREE DELIVERY</Text>
                  </View>
                )}
              </View>
              <Image
                source={{ uri: FOOD_IMAGES[index % FOOD_IMAGES.length] }}
                style={styles.cardImage}
              />
            </View>
          </TouchableOpacity>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.gold,
    letterSpacing: 1,
  },
  logoSubtitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 2,
    marginTop: -2,
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
});
