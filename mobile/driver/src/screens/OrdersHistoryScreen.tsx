import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, RefreshControl } from 'react-native';
import type { EarningsSummary } from '@chisinau/shared-domain';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { fetchDeliveryHistory, userMessage, DeliveredRow } from '../lib/api';
import { historyExtraLines } from '../lib/earnings';

export default function OrdersHistoryScreen() {
  const [rows, setRows] = useState<DeliveredRow[]>([]);
  const [today, setToday] = useState<EarningsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const h = await fetchDeliveryHistory();
      setRows(h.rows);
      setToday(h.today);
      setError(null);
    } catch (err) {
      setError(userMessage(err, 'Istoricul nu s-a putut încărca.'));
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
        <Text style={styles.title}>Istoric Livrări</Text>
        <Text style={styles.subtitle}>
          Azi · {today?.ordersCount ?? 0} {today?.ordersCount === 1 ? 'livrare încasată' : 'livrări încasate'} ·{' '}
          <Text style={{ color: COLORS.gold, fontWeight: '700' }}>{today?.netMdl ?? 0} MDL net</Text>
          {today && today.pendingCount > 0 ? ` · ${today.pendingCount} ${today.pendingCount === 1 ? 'neîncasată' : 'neîncasate'}` : ''}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {error && (
          <Text style={{ color: COLORS.primary, textAlign: 'center', marginTop: 16 }}>{error}</Text>
        )}
        {rows.length === 0 && !error && (
          <Text style={{ color: COLORS.textSecondary, textAlign: 'center', marginTop: 48 }}>
            Nicio livrare finalizată încă.
          </Text>
        )}
        {rows.map(order => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderLeft}>
              <View style={styles.iconBox}>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
              </View>
              <View>
                <Text style={styles.orderRestaurant}>{order.restaurant}</Text>
                <Text style={styles.orderCustomer}>{order.orderNumber}</Text>
                <View style={styles.orderMeta}>
                  <Text style={styles.orderTime}>{order.time}</Text>
                </View>
                {historyExtraLines(order).map((line) => (
                  <Text key={line} style={styles.orderTime}>
                    {line}
                  </Text>
                ))}
              </View>
            </View>
            <Text style={[styles.orderEarnings, order.netMdl === null && { color: COLORS.textMuted }]}>
              {order.netMdl === null ? 'neîncasat' : `${order.netMdl} MDL`}
            </Text>
          </View>
        ))}
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
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  orderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.success + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderRestaurant: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
  },
  orderCustomer: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  orderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  orderTime: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  orderDot: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  orderDistance: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  orderEarnings: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.gold,
  },
});
