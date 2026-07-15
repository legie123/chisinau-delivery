import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS } from '../theme';
import { fetchMyOrders, isSignedIn, CustomerOrder } from '../lib/api';

function statusColor(status: string): string {
  if (status === 'delivered') return COLORS.success;
  if (status === 'cancelled' || status === 'rejected') return COLORS.error;
  return COLORS.warning;
}

export default function OrdersScreen() {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [signedIn, setSignedIn] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const authed = await isSignedIn();
    setSignedIn(authed);
    if (!authed) return;
    try {
      setOrders(await fetchMyOrders());
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
        {!signedIn && <Text style={styles.emptyText}>Autentifică-te din coș ca să vezi comenzile tale.</Text>}
        {signedIn && orders.length === 0 && <Text style={styles.emptyText}>Nu ai plasat nicio comandă încă.</Text>}
        {orders.map(order => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderRestaurant}>{order.orderNumber}</Text>
              <View style={[styles.statusBadge, { backgroundColor: statusColor(order.status) + '20', borderColor: statusColor(order.status) + '40' }]}>
                <Text style={[styles.statusText, { color: statusColor(order.status) }]}>{order.statusLabel}</Text>
              </View>
            </View>
            <View style={styles.orderFooter}>
              <Text style={styles.orderDate}>{order.createdAt}</Text>
              <Text style={styles.orderTotal}>{order.total}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 48,
  },
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
  orderCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderRestaurant: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  orderItems: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderDate: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  orderTotal: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gold,
  },
});
