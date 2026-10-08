import React, { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatClock } from '@chisinau/shared-domain';
import { COLORS } from '../../theme';
import { statusLabel } from '../../lib/orderStatus';
import {
  QUOTE_LABEL,
  SUPPORT_EMAIL,
  SUPPORT_PHONE_LABEL,
  SUPPORT_TEL,
  formatEventDate,
  guestsLabel,
  prepCountdown,
  supportMailto,
  type PaymentNotice,
} from '../../lib/tracking';
import type { OrderDetail } from '../../lib/orderDetail';

function open(url: string) {
  Linking.openURL(url).catch(() => Alert.alert('Eroare', 'Nu am putut deschide aplicația de apel sau de e-mail.'));
}

/** "Gata în ~N min" from estimated_ready_at, re-read every 30s (PrepCountdown.tsx). */
export function PrepCountdown({ estimatedReadyAt, status }: { estimatedReadyAt: string; status: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const { headline, arrive } = prepCountdown(estimatedReadyAt, status);
  return (
    <View style={styles.prep}>
      <Text style={styles.prepHeadline}>{headline}</Text>
      <Text style={styles.mutedSmall}>{arrive}</Text>
    </View>
  );
}

export function CourierCard({ name, tel, subtitle }: { name: string | null; tel: string | null; subtitle: string }) {
  return (
    <View style={[styles.card, styles.row]}>
      <View style={styles.avatar}><Text style={{ fontSize: 20 }}>🛵</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitleTight}>{name ? `${name} e pe drum` : 'Curierul tău e pe drum'}</Text>
        <Text style={styles.mutedSmallTight}>{subtitle}</Text>
      </View>
      {tel && (
        <TouchableOpacity
          style={styles.callBtn}
          onPress={() => open(tel)}
          accessibilityRole="button"
          accessibilityLabel={name ? `Sună-l pe ${name}` : 'Sună curierul'}
        >
          <Ionicons name="call" size={16} color={COLORS.white} />
          <Text style={styles.callText}>Sună curierul</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function PaymentNoticeBox({ notice }: { notice: PaymentNotice }) {
  const color = notice.tone === 'good' ? COLORS.success : COLORS.gold;
  return (
    <View style={[styles.notice, { borderColor: color + '55', backgroundColor: color + '14' }]} accessibilityRole="alert">
      <Text style={{ color, fontWeight: '700' }}>{notice.label}</Text>
      {notice.detail && <Text style={styles.mutedSmallTight}>{notice.detail}</Text>}
    </View>
  );
}

export function StatusTimeline({ events }: { events: OrderDetail['events'] }) {
  if (events.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>ISTORIC</Text>
      {events.map(e => (
        <View key={e.id} style={styles.timelineRow}>
          <View style={styles.dot} />
          <Text style={[styles.itemText, { flex: 1 }]}>{statusLabel(e.status)}</Text>
          <Text style={styles.mutedSmallTight}>{formatClock(e.createdAt)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Quote wording, event date/time, guest count, restaurant's note (CateringTracking.tsx). */
export function CateringStatus({ catering, status, cancellationReason }: {
  catering: NonNullable<OrderDetail['catering']>;
  status: string;
  cancellationReason: string | null;
}) {
  const finished = status === 'cancelled' || status === 'rejected' || status === 'delivered';
  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>CATERING</Text>
      <Text style={styles.cardTitleTight}>
        {finished ? statusLabel(status) : QUOTE_LABEL[catering.quoteStatus] ?? 'Se actualizează'}
      </Text>
      {finished && cancellationReason && <Text style={styles.mutedSmallTight}>{cancellationReason}</Text>}
      {catering.quoteStatus === 'confirmed' && !finished && (
        <Text style={styles.mutedSmallTight}>Status livrare: {statusLabel(status)}</Text>
      )}
      <Text style={[styles.itemText, { marginTop: 10 }]}>
        📅 {formatEventDate(catering.eventDate)}
        {catering.eventTime ? ` · ${catering.eventTime.slice(0, 5)}` : ''} · {guestsLabel(catering.guestCount)}
      </Text>
      {catering.quotedTotalMdl != null && (catering.quoteStatus === 'quoted' || catering.quoteStatus === 'confirmed') && (
        <Text style={[styles.itemText, { marginTop: 4 }]}>Total ofertat: {catering.quotedTotalMdl.toFixed(2)} MDL</Text>
      )}
      {catering.restaurantNotes && (
        <Text style={styles.mutedSmall}>Mesaj de la restaurant: {catering.restaurantNotes}</Text>
      )}
    </View>
  );
}

/** Same channel as the web footer: mail + phone, no in-app form. */
export function SupportLinks({ orderNumber }: { orderNumber: string }) {
  return (
    <View style={styles.support}>
      <Text style={styles.mutedSmallTight}>Ai o problemă cu comanda?</Text>
      <View style={styles.supportRow}>
        <TouchableOpacity onPress={() => open(supportMailto(orderNumber))} accessibilityRole="link">
          <Text style={styles.link}>{SUPPORT_EMAIL}</Text>
        </TouchableOpacity>
        <Text style={styles.mutedSmallTight}>·</Text>
        <TouchableOpacity onPress={() => open(SUPPORT_TEL)} accessibilityRole="link">
          <Text style={styles.link}>{SUPPORT_PHONE_LABEL}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, marginTop: 12, borderWidth: 1, borderColor: COLORS.cardBorder },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary + '33', alignItems: 'center', justifyContent: 'center' },
  cardTitleTight: { color: COLORS.white, fontWeight: '800', fontSize: 15 },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  callText: { color: COLORS.white, fontWeight: '800', fontSize: 13 },
  prep: { alignItems: 'center', marginTop: 10 },
  prepHeadline: { color: COLORS.gold, fontWeight: '800', fontSize: 15 },
  notice: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8, gap: 2 },
  sectionLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 10 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  itemText: { color: COLORS.white, fontSize: 14 },
  mutedSmall: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  mutedSmallTight: { color: COLORS.textSecondary, fontSize: 12 },
  support: { alignItems: 'center', marginTop: 24, gap: 6 },
  supportRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { color: COLORS.textSecondary, fontSize: 12, textDecorationLine: 'underline' },
});
