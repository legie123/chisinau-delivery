import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS } from '../theme';
import { fetchMyOrders, isSignedIn, CustomerOrder } from '../lib/api';
import { statusLabel, statusTone } from '../lib/orderStatus';

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
            <TouchableOpacity
              key={order.id}
              style={styles.orderCard}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('OrderTracking', { orderId: order.id })}
            >
              <View style={styles.orderHeader}>
                <Text style={styles.orderRestaurant}>{order.restaurantName || order.orderNumber}</Text>
                <View style={[styles.statusBadge, { backgroundColor: color + '20', borderColor: color + '40' }]}>
                  <Text style={[styles.statusText, { color }]}>{statusLabel(order.status)}</Text>
                </View>
              </View>
              <Text style={styles.orderItems}>
                {order.orderNumber}{order.orderType === 'catering' ? ' · Catering' : ''}
              </Text>
              <View style={styles.orderFooter}>
                <Text style={styles.orderDate}>{when.format(new Date(order.createdAt))}</Text>
                <Text style={styles.orderTotal}>{order.totalMdl.toFixed(2)} MDL</Text>
              </View>
            </TouchableOpacity>
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
});
