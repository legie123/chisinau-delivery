import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import type { DriverOrder } from '../lib/api';

interface Props {
  order: DriverOrder;
  expiresAt: string;
  distanceKm: number | null;
  pending: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onExpire: () => void;
}

// Push-dispatch offer with a 30s countdown — mirrors
// src/components/courier/OfferCard.tsx on the web app. Accept/decline always
// go through the accept_dispatch_offer / decline_dispatch_offer RPCs (never a
// raw orders update), so the scored dispatch engine stays authoritative.
export default function OfferCard({ order, expiresAt, distanceKm, pending, onAccept, onDecline, onExpire }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadline = new Date(expiresAt).getTime();
  const remaining = Math.max(0, deadline - now);
  const secs = Math.ceil(remaining / 1000);

  useEffect(() => {
    if (remaining === 0) onExpire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === 0]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Ionicons name="flash" size={14} color={COLORS.gold} />
          <Text style={styles.badgeText}>Comandă nouă pentru tine</Text>
        </View>
        <View style={[styles.timer, secs <= 10 && styles.timerUrgent]}>
          <Text style={styles.timerText}>{secs}s</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.restaurant}>{order.restaurant}</Text>
        <Text style={styles.earnings}>{order.earnings}</Text>
      </View>
      <Text style={styles.meta}>
        {distanceKm != null ? `~${distanceKm.toFixed(1)} km până la restaurant` : 'Distanță estimată'}
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.declineBtn} onPress={onDecline} disabled={pending}>
          <Text style={styles.declineText}>Refuză</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceptBtn} onPress={onAccept} disabled={pending || secs === 0}>
          <Text style={styles.acceptText}>Acceptă</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 120,
    left: 16,
    right: 16,
    backgroundColor: COLORS.card,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 12,
    zIndex: 101,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(212,175,55,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#D4AF37',
    textTransform: 'uppercase',
  },
  timer: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  timerUrgent: {
    backgroundColor: 'rgba(233,69,96,0.2)',
  },
  timerText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
  },
  body: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 12,
  },
  restaurant: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.white,
  },
  earnings: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.gold,
  },
  meta: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  declineBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  declineText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  acceptBtn: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#4CD964',
  },
  acceptText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
  },
});
