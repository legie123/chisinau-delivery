import React from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

const MOCK_HISTORY = [
  { id: 1, restaurant: "Dragon's Wok", customer: "Alexandru P.", earnings: "12 RON", time: "14:30", distance: "2.3 km", status: "Livrat" },
  { id: 2, restaurant: "Casa Românească", customer: "Maria I.", earnings: "15 RON", time: "13:15", distance: "3.1 km", status: "Livrat" },
  { id: 3, restaurant: "Sushi Dragon", customer: "Andrei V.", earnings: "10 RON", time: "12:00", distance: "1.8 km", status: "Livrat" },
  { id: 4, restaurant: "Pizza Inferno", customer: "Elena M.", earnings: "18 RON", time: "11:20", distance: "4.2 km", status: "Livrat" },
  { id: 5, restaurant: "Burger Palace", customer: "Ion C.", earnings: "9 RON", time: "10:45", distance: "1.5 km", status: "Livrat" },
];

export default function OrdersHistoryScreen() {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <Text style={styles.title}>Istoric Livrări</Text>
        <Text style={styles.subtitle}>Azi · 5 livrări completate</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {MOCK_HISTORY.map(order => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderLeft}>
              <View style={styles.iconBox}>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
              </View>
              <View>
                <Text style={styles.orderRestaurant}>{order.restaurant}</Text>
                <Text style={styles.orderCustomer}>→ {order.customer}</Text>
                <View style={styles.orderMeta}>
                  <Text style={styles.orderTime}>{order.time}</Text>
                  <Text style={styles.orderDot}>·</Text>
                  <Text style={styles.orderDistance}>{order.distance}</Text>
                </View>
              </View>
            </View>
            <Text style={styles.orderEarnings}>{order.earnings}</Text>
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
