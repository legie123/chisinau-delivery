import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { errorText, fetchMyOrders, fetchReorderSource, fetchRestaurantById, isSignedIn, CustomerOrder } from '../lib/api';
import { statusLabel, statusTone } from '../lib/orderStatus';
import { getCart, setCart } from '../lib/cart';
import { planReorder, reorderSkipText } from '../lib/reorder';
import { runExclusive } from '../lib/checkout';

/** Web parity (orders/page.tsx canReorder): only delivered delivery orders go back to a cart. */
const canReorder = (o: CustomerOrder) => o.status === 'delivered' && o.orderType === 'standard' && o.restaurantId != null;

function toneColor(status: string): string {
  const tone = statusTone(status);
  return tone === 'done' ? COLORS.success : tone === 'failed' ? COLORS.error : COLORS.warning;
}

const when = new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Chisinau' });

export default function OrdersScreen({ navigation }: { navigation: any }) {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [signedIn, setSignedIn] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const authed = await isSignedIn();
    setSignedIn(authed);
    if (!authed) return;
    try {
      setOrders(await fetchMyOrders());
      setLoadError(null);
    } catch {
      setLoadError('Nu am putut încărca comenzile. Trage în jos pentru a reîncerca.');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // "Comandă din nou" (web ReorderButton): the order's items + original options go
  // back into the cart; what can't (gone, or a new required option) is named.
  const [reordering, setReordering] = useState<string | null>(null);
  const reorderLock = useRef(false);

  async function openMenu(restaurantId: string) {
    try {
      const restaurant = await fetchRestaurantById(restaurantId);
      if (restaurant) navigation.navigate('Restaurant', { restaurant });
      else Alert.alert('Comandă din nou', 'Restaurantul nu mai este disponibil.');
    } catch (err) {
      Alert.alert('Comandă din nou', errorText(err, 'Nu am putut deschide meniul.'));
    }
  }

  const reorder = (order: CustomerOrder) =>
    runExclusive(reorderLock, async () => {
      const restaurantId = order.restaurantId!;
      setReordering(order.id);
      try {
        const src = await fetchReorderSource(order.id);
        const plan = planReorder({ id: restaurantId, name: order.restaurantName || 'Restaurant' }, src.items, src.groups, src.live);
        const notice = reorderSkipText(plan.skipped);
        if (plan.cart.lines.length === 0) {
          Alert.alert('Comandă din nou', `${notice ?? 'Produsele nu mai sunt disponibile.'} Alege din meniul restaurantului.`, [
            { text: 'Renunță', style: 'cancel' },
            { text: 'Deschide meniul', onPress: () => openMenu(restaurantId) },
          ]);
          return;
        }
        const apply = () => {
          setCart(plan.cart);
          navigation.navigate('Cart');
          if (notice) Alert.alert('Câteva produse lipsesc', notice);
        };
        // One restaurant per cart: replacing a non-empty cart is asked, never silent.
        const current = getCart();
        if (current.lines.length > 0) {
          Alert.alert(
            'Înlocuiești coșul?',
            `Coșul are deja produse${current.restaurantName ? ` de la ${current.restaurantName}` : ''}. Le înlocuim cu comanda ${order.orderNumber}?`,
            [
              { text: 'Renunță', style: 'cancel' },
              { text: 'Înlocuiește', style: 'destructive', onPress: apply },
            ],
          );
        } else apply();
      } catch (err) {
        Alert.alert('Comandă din nou', errorText(err, 'Nu am putut pregăti coșul. Încearcă din nou.'));
      } finally {
        setReordering(null);
      }
    });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <Text style={styles.title}>Comenzile mele</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {!signedIn && (
          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.emptyText}>Autentifică-te ca să vezi comenzile tale.</Text>
          </TouchableOpacity>
        )}
        {loadError && <Text style={styles.emptyText}>{loadError}</Text>}
        {signedIn && !loadError && orders.length === 0 && <Text style={styles.emptyText}>Nu ai plasat nicio comandă încă.</Text>}
        {orders.map(order => {
          const color = toneColor(order.status);
          return (
            <View key={order.id} style={styles.orderCard}>
            <TouchableOpacity activeOpacity={0.8} onPress={() => navigation.navigate('OrderTracking', { orderId: order.id })}>
              <View style={styles.orderHeader}>
                <Text style={styles.orderRestaurant}>{order.restaurantName || order.orderNumber}</Text>
                <View style={[styles.statusBadge, { backgroundColor: color + '20', borderColor: color + '40' }]}>
                  <Text style={[styles.statusText, { color }]}>{statusLabel(order.status)}</Text>
                </View>
              </View>
              <Text style={styles.orderItems}>
                {order.orderNumber}{order.orderType === 'catering' ? ' · Catering' : ''}
                {order.requestedFor ? ` · 🕒 programată ${when.format(new Date(order.requestedFor))}` : ''}
              </Text>
              <View style={styles.orderFooter}>
                <Text style={styles.orderDate}>{when.format(new Date(order.createdAt))}</Text>
                <Text style={styles.orderTotal}>{order.totalMdl.toFixed(2)} MDL</Text>
              </View>
            </TouchableOpacity>
            {canReorder(order) && (
              <TouchableOpacity style={styles.reorderBtn} onPress={() => reorder(order)} disabled={reordering !== null} accessibilityLabel="Comandă din nou">
                {reordering === order.id ? <ActivityIndicator size="small" color={COLORS.gold} /> : <Ionicons name="repeat" size={15} color={COLORS.gold} />}
                <Text style={styles.reorderText}>{reordering === order.id ? 'Se pregătește coșul...' : 'Comandă din nou'}</Text>
              </TouchableOpacity>
            )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 48 },
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 20, paddingTop: 60 },
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '900', color: COLORS.white },
  orderCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.cardBorder },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 },
  orderRestaurant: { fontSize: 16, fontWeight: '700', color: COLORS.white, flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  statusText: { fontSize: 11, fontWeight: '700' },
  orderItems: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 10 },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderDate: { fontSize: 12, color: COLORS.textMuted },
  orderTotal: { fontSize: 15, fontWeight: '700', color: COLORS.gold },
  reorderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1, borderColor: COLORS.gold + '50', backgroundColor: COLORS.gold + '12',
  },
  reorderText: { color: COLORS.gold, fontWeight: '700', fontSize: 13 },
});
