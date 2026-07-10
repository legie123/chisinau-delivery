import React, { useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

const WEEKLY_DATA = [
  { day: 'Lun', amount: 85, orders: 7 },
  { day: 'Mar', amount: 120, orders: 9 },
  { day: 'Mie', amount: 95, orders: 8 },
  { day: 'Joi', amount: 142, orders: 11 },
  { day: 'Vin', amount: 168, orders: 13 },
  { day: 'Sâm', amount: 195, orders: 15 },
  { day: 'Dum', amount: 142, orders: 11 },
];

export default function EarningsScreen() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week');
  const totalWeek = WEEKLY_DATA.reduce((s, d) => s + d.amount, 0);
  const totalOrders = WEEKLY_DATA.reduce((s, d) => s + d.orders, 0);
  const maxAmount = Math.max(...WEEKLY_DATA.map(d => d.amount));

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <Text style={styles.title}>Câștiguri</Text>
      </View>

      {/* Period Selector */}
      <View style={styles.periodRow}>
        {(['today', 'week', 'month'] as const).map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
              {p === 'today' ? 'Azi' : p === 'week' ? 'Săptămâna' : 'Luna'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Total Card */}
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total câștiguri</Text>
        <Text style={styles.totalAmount}>{totalWeek} RON</Text>
        <View style={styles.totalMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="bicycle" size={16} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{totalOrders} livrări</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="time" size={16} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>~28 min/livrare</Text>
          </View>
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartSection}>
        <Text style={styles.chartTitle}>Această săptămână</Text>
        <View style={styles.chart}>
          {WEEKLY_DATA.map((d, i) => (
            <View key={i} style={styles.barContainer}>
              <View style={styles.barWrapper}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: `${(d.amount / maxAmount) * 100}%`,
                      backgroundColor: i === 3 ? COLORS.primary : COLORS.gold + '60',
                    },
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, i === 3 && { color: COLORS.primary, fontWeight: '700' }]}>
                {d.day}
              </Text>
              <Text style={styles.barAmount}>{d.amount}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Stats */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
        <View style={[styles.statCard, { borderColor: COLORS.gold + '30' }]}>
          <Ionicons name="trophy" size={24} color={COLORS.gold} />
          <Text style={styles.statValue}>4.9</Text>
          <Text style={styles.statLabel}>Rating</Text>
        </View>
        <View style={[styles.statCard, { borderColor: COLORS.success + '30' }]}>
          <Ionicons name="checkmark-done" size={24} color={COLORS.success} />
          <Text style={styles.statValue}>98%</Text>
          <Text style={styles.statLabel}>Completare</Text>
        </View>
        <View style={[styles.statCard, { borderColor: COLORS.primary + '30' }]}>
          <Ionicons name="flash" size={24} color={COLORS.primary} />
          <Text style={styles.statValue}>24 min</Text>
          <Text style={styles.statLabel}>Timp mediu</Text>
        </View>
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
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.white,
  },
  periodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  periodBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  periodBtnActive: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary + '50',
  },
  periodText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  periodTextActive: {
    color: COLORS.primary,
  },
  totalCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.gold + '20',
  },
  totalLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  totalAmount: {
    fontSize: 36,
    fontWeight: '900',
    color: COLORS.gold,
    marginBottom: 12,
  },
  totalMeta: {
    flexDirection: 'row',
    gap: 20,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  chartSection: {
    marginBottom: 24,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 16,
  },
  chart: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
  },
  barContainer: {
    alignItems: 'center',
    flex: 1,
  },
  barWrapper: {
    width: 24,
    height: 90,
    justifyContent: 'flex-end',
    borderRadius: 6,
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
    borderRadius: 6,
  },
  barLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 6,
  },
  barAmount: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  statsRow: {
    gap: 12,
    paddingBottom: 20,
  },
  statCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    width: 110,
    borderWidth: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.white,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 4,
  },
});
