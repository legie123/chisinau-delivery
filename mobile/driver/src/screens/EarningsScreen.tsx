import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { fetchEarningsSummary, EarningsSummary, PayoutRow } from '../lib/api';

const PAYOUT_STATUS_LABEL: Record<PayoutRow['status'], string> = {
  paid: 'Plătit ✓',
  failed: 'Eșuat',
  pending: 'În așteptare',
};

const PAYOUT_STATUS_COLOR: Record<PayoutRow['status'], string> = {
  paid: COLORS.success,
  failed: COLORS.primary,
  pending: COLORS.gold,
};

function formatPeriod(start: string, end: string) {
  const fmt = (d: string) => new Date(d).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

// Real earnings (fixes fabricated RON numbers, finding #23) — mirrors
// src/app/(courier)/earnings/page.tsx on the web app: this-week delivery
// earnings (delivery fee + tip, delivered+paid orders only) and the payout
// history the platform settles, in MDL.
export default function EarningsScreen() {
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchEarningsSummary()
      .then((s) => {
        if (mounted) setSummary(s);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Câștiguri</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.gold} style={styles.loading} />
        ) : (
          <>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Săptămâna aceasta</Text>
              <Text style={styles.totalAmount}>{summary?.weekEarningsMdl ?? 0} MDL</Text>
              <View style={styles.totalMeta}>
                <View style={styles.metaItem}>
                  <Ionicons name="bicycle" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.metaText}>
                    {summary?.weekOrdersCount ?? 0} {summary?.weekOrdersCount === 1 ? 'livrare completată' : 'livrări completate'}
                  </Text>
                </View>
              </View>
              <Text style={styles.totalHint}>Taxă livrare + bacșiș, doar comenzi livrate și plătite</Text>
            </View>

            <Text style={styles.sectionTitle}>Plăți</Text>
            {!summary || summary.payouts.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>Nicio plată încă — apar aici după prima decontare.</Text>
              </View>
            ) : (
              summary.payouts.map((p) => (
                <View key={p.id} style={styles.payoutCard}>
                  <View style={styles.payoutHeader}>
                    <Text style={styles.payoutPeriod}>{formatPeriod(p.periodStart, p.periodEnd)}</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: PAYOUT_STATUS_COLOR[p.status] + '20', borderColor: PAYOUT_STATUS_COLOR[p.status] + '40' },
                      ]}
                    >
                      <Text style={[styles.statusText, { color: PAYOUT_STATUS_COLOR[p.status] }]}>
                        {PAYOUT_STATUS_LABEL[p.status]}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.payoutStats}>
                    <View style={styles.payoutStat}>
                      <Text style={styles.payoutStatLabel}>Comenzi</Text>
                      <Text style={styles.payoutStatValue}>{p.ordersCount}</Text>
                    </View>
                    <View style={styles.payoutStat}>
                      <Text style={styles.payoutStatLabel}>Brut</Text>
                      <Text style={styles.payoutStatValue}>{p.grossMdl} MDL</Text>
                    </View>
                    <View style={styles.payoutStat}>
                      <Text style={styles.payoutStatLabel}>Comision</Text>
                      <Text style={styles.payoutStatValueMuted}>−{p.commissionMdl} MDL</Text>
                    </View>
                    <View style={styles.payoutStat}>
                      <Text style={styles.payoutStatLabel}>Net</Text>
                      <Text style={styles.payoutStatValueGold}>{p.netMdl} MDL</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </>
        )}
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
  loading: {
    marginTop: 60,
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
  totalHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  payoutCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  payoutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  payoutPeriod: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
  },
  statusBadge: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  payoutStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  payoutStat: {
    flex: 1,
  },
  payoutStatLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  payoutStatValue: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.white,
  },
  payoutStatValueMuted: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  payoutStatValueGold: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.gold,
  },
});
