import React from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

const MOCK_ORDERS = [
  { id: 1, restaurant: "Dragon's Wok", items: "2x Pad Thai, 1x Spring Rolls", total: "82 RON", status: "Livrat", date: "Azi, 14:30", statusColor: COLORS.success },
  { id: 2, restaurant: "Casa Românească", items: "1x Ciorbă de burtă, 1x Mici", total: "45 RON", status: "În pregătire", date: "Azi, 13:15", statusColor: COLORS.warning },
  { id: 3, restaurant: "Sushi Dragon", items: "1x Dragon Roll, 1x Miso Soup", total: "68 RON", status: "Livrat", date: "Ieri, 20:00", statusColor: COLORS.success },
];

export default function OrdersScreen() {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <Text style={styles.title}>Comenzile mele</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {MOCK_ORDERS.map(order => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderRestaurant}>{order.restaurant}</Text>
              <View style={[styles.statusBadge, { backgroundColor: order.statusColor + '20', borderColor: order.statusColor + '40' }]}>
                <Text style={[styles.statusText, { color: order.statusColor }]}>{order.status}</Text>
              </View>
            </View>
            <Text style={styles.orderItems}>{order.items}</Text>
            <View style={styles.orderFooter}>
              <Text style={styles.orderDate}>{order.date}</Text>
              <Text style={styles.orderTotal}>{order.total}</Text>
            </View>
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
