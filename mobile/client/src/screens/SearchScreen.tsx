import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, StatusBar, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { fetchRestaurants, searchDishes } from '../lib/api';
import { DEFAULT_FILTER, filterRestaurants, isStale, type BrowseFilter } from '../lib/browse';
import BrowseFilters from '../components/BrowseFilters';
import { Restaurant } from '../types';

type DishSearchResult = Awaited<ReturnType<typeof searchDishes>>[number];

interface Props {
  navigation: any;
}

function Thumb({ uri }: { uri: string | null }) {
  return uri ? <Image source={{ uri }} style={styles.resultImage} /> : <View style={[styles.resultImage, { backgroundColor: COLORS.surfaceLight }]} />;
}

export default function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<BrowseFilter>(DEFAULT_FILTER);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [dishResults, setDishResults] = useState<DishSearchResult[]>([]);
  const [searchingDishes, setSearchingDishes] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadedAt = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRestaurants(await fetchRestaurants());
      loadedAt.current = Date.now();
      setLoadError(null);
    } catch {
      setLoadError('Nu am putut încărca restaurantele. Verifică conexiunea.');
    }
  }, []);

  // Re-read on focus once the list is a minute old: "Deschis acum" must not go stale.
  useFocusEffect(
    useCallback(() => {
      if (isStale(loadedAt.current, Date.now())) load();
    }, [load]),
  );

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
    searchDishes(debouncedQuery)
      .then(results => { if (!cancelled) setDishResults(results); })
      .catch(() => { if (!cancelled) setDishResults([]); })
      .finally(() => { if (!cancelled) setSearchingDishes(false); });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const restaurantResults = useMemo(
    () => filterRestaurants(restaurants, { ...filter, query: debouncedQuery.length >= 2 ? debouncedQuery : '' }),
    [restaurants, debouncedQuery, filter],
  );

  const isSearching = debouncedQuery.length >= 2 || filter.category !== 'all' || filter.openNowOnly;

  function openRestaurant(restaurant: Restaurant) {
    navigation.navigate('Restaurant', { restaurantId: restaurant.id, restaurant });
  }

  // Web parity (/restaurants/<slug>?item=<id>): open the restaurant AND scroll to the dish.
  // Only ids travel; RestaurantScreen loads the restaurant itself, so no waiting on this list.
  function openDish(dish: DishSearchResult) {
    navigation.navigate('Restaurant', { restaurantId: dish.restaurant_id, itemId: dish.item_id });
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

        <BrowseFilters value={filter} onChange={setFilter} />

        {loadError && (
          <View style={styles.errorBox}>
            <Text style={styles.emptyText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Reîncearcă</Text>
            </TouchableOpacity>
          </View>
        )}

        {isSearching && (
          <>
            <Text style={styles.sectionTitle}>Restaurante</Text>
            {restaurantResults.length === 0 && <Text style={styles.emptyText}>Niciun restaurant găsit.</Text>}
            {restaurantResults.map(r => (
              <TouchableOpacity key={r.id} style={styles.resultRow} activeOpacity={0.8} onPress={() => openRestaurant(r)}>
                <Thumb uri={r.logoUrl ?? r.coverUrl} />
                <View style={styles.resultText}>
                  <Text style={styles.resultName}>{r.name}</Text>
                  <Text style={styles.resultMeta}>{r.category}{r.openNow && r.acceptingOrders ? '' : ' · Închis acum'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}

            {debouncedQuery.length >= 2 && (
              <>
                <Text style={styles.sectionTitle}>Preparate</Text>
                {!searchingDishes && dishResults.length === 0 && <Text style={styles.emptyText}>Niciun preparat găsit.</Text>}
                {dishResults.map(dish => (
                  <TouchableOpacity key={dish.item_id} style={styles.resultRow} activeOpacity={0.8} onPress={() => openDish(dish)}>
                    <Thumb uri={dish.photo_url} />
                    <View style={styles.resultText}>
                      <Text style={styles.resultName}>{dish.item_name}</Text>
                      <Text style={styles.resultMeta}>{dish.restaurant_name} · {dish.price_mdl} MDL</Text>
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
  errorBox: { alignItems: 'center', gap: 12, marginBottom: 16 },
  retryBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: COLORS.white, fontWeight: '700' },
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
