import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, StatusBar, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { CUISINE_LABEL, DishSearchResult, fetchRestaurants, searchMenuItems } from '../lib/api';
import { Restaurant } from '../types';

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=300&fit=crop';
const CATEGORIES = Object.entries(CUISINE_LABEL).map(([cuisine, label]) => ({ cuisine, label }));

interface Props {
  navigation: any;
}

export default function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCuisine, setSelectedCuisine] = useState<string | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [dishResults, setDishResults] = useState<DishSearchResult[]>([]);
  const [searchingDishes, setSearchingDishes] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRestaurants()
      .then(data => { if (!cancelled) setRestaurants(data); })
      .catch(() => { if (!cancelled) setLoadError('Nu am putut încărca restaurantele. Verifică conexiunea.'); });
    return () => { cancelled = true; };
  }, []);

  // Debounce the free-text query before hitting the dish-search RPC.
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setDishResults([]);
      return;
    }
    let cancelled = false;
    setSearchingDishes(true);
    searchMenuItems(debouncedQuery)
      .then(results => { if (!cancelled) setDishResults(results); })
      .catch(() => { if (!cancelled) setDishResults([]); })
      .finally(() => { if (!cancelled) setSearchingDishes(false); });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const restaurantResults = useMemo(() => {
    return restaurants.filter(r => {
      const matchesQuery = debouncedQuery.length < 2 || r.name.toLowerCase().includes(debouncedQuery.toLowerCase());
      const matchesCuisine = !selectedCuisine || r.cuisine === selectedCuisine;
      return matchesQuery && matchesCuisine;
    });
  }, [restaurants, debouncedQuery, selectedCuisine]);

  const isSearching = debouncedQuery.length >= 2 || !!selectedCuisine;

  function openRestaurant(restaurant: Restaurant) {
    navigation.navigate('Restaurant', { restaurant, imageUrl: restaurant.coverUrl ?? FALLBACK_IMAGE });
  }

  function openDish(dish: DishSearchResult) {
    const restaurant = restaurants.find(r => r.id === dish.restaurantId);
    if (!restaurant) return;
    openRestaurant(restaurant);
  }

  function toggleCuisine(cuisine: string) {
    setSelectedCuisine(prev => (prev === cuisine ? null : cuisine));
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Caută</Text>
          <Text style={styles.subtitle}>Ce ți-e poftă azi?</Text>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Caută restaurante sau preparate..."
            placeholderTextColor={COLORS.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          {searchingDishes && <ActivityIndicator size="small" color={COLORS.primary} />}
        </View>

        <Text style={styles.sectionTitle}>Categorii</Text>
        <View style={styles.grid}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.cuisine}
              style={[styles.categoryCard, selectedCuisine === cat.cuisine && styles.categoryCardActive]}
              activeOpacity={0.8}
              onPress={() => toggleCuisine(cat.cuisine)}
            >
              <Text style={styles.categoryName}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loadError && <Text style={styles.emptyText}>{loadError}</Text>}

        {isSearching && (
          <>
            <Text style={styles.sectionTitle}>Restaurante</Text>
            {restaurantResults.length === 0 && <Text style={styles.emptyText}>Niciun restaurant găsit.</Text>}
            {restaurantResults.map(r => (
              <TouchableOpacity key={r.id} style={styles.resultRow} activeOpacity={0.8} onPress={() => openRestaurant(r)}>
                <Image source={{ uri: r.logoUrl ?? r.coverUrl ?? FALLBACK_IMAGE }} style={styles.resultImage} />
                <View style={styles.resultText}>
                  <Text style={styles.resultName}>{r.name}</Text>
                  <Text style={styles.resultMeta}>{r.category}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}

            {debouncedQuery.length >= 2 && (
              <>
                <Text style={styles.sectionTitle}>Preparate</Text>
                {!searchingDishes && dishResults.length === 0 && <Text style={styles.emptyText}>Niciun preparat găsit.</Text>}
                {dishResults.map(dish => (
                  <TouchableOpacity key={dish.itemId} style={styles.resultRow} activeOpacity={0.8} onPress={() => openDish(dish)}>
                    <Image source={{ uri: dish.photoUrl ?? FALLBACK_IMAGE }} style={styles.resultImage} />
                    <View style={styles.resultText}>
                      <Text style={styles.resultName}>{dish.itemName}</Text>
                      <Text style={styles.resultMeta}>{dish.restaurantName} · {dish.priceMdl} MDL</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.white,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 50,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 28,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 16,
    marginTop: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  categoryCard: {
    width: '47%',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  categoryCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '15',
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  emptyText: {
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    gap: 12,
  },
  resultImage: {
    width: 48,
    height: 48,
    borderRadius: 10,
  },
  resultText: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
  },
  resultMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});
