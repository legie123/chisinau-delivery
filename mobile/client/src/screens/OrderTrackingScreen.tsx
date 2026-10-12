import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, ActivityIndicator, Alert, AppState, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { cancelOrder, confirmCateringQuote, setOrderTip, submitRating } from '@chisinau/shared-api';
import { asOrderId } from '@chisinau/shared-types';
import { COLORS } from '../theme';
import { supabase } from '../lib/supabase';
import { errorText } from '../lib/api';
import { fetchCourierSeed, fetchOrderDetail, mergeOrderRow, type OrderDetail } from '../lib/orderDetail';
import ReportProblem from '../components/tracking/ReportProblem';
import { subscribeCourierLocation, subscribeOrderChildren, subscribeOrderRow, type LatLng } from '../lib/realtime';
import {
  PROGRESS_STEPS,
  customerCanCancel,
  customerCanReport,
  customerCanTip,
  isTerminal,
  progressIndex,
  showsCourierOnMap,
  statusLabel,
  statusTone,
} from '../lib/orderStatus';
import { tipAmount, type TipChoice } from '../lib/checkout';
import { courierActive, firstName, paymentPresence, showsPrepCountdown, telUrl, trackingRoute } from '../lib/tracking';
import { TrackingMap } from '../components/tracking/TrackingMap';
import {
  CateringStatus,
  CourierCard,
  PaymentNoticeBox,
  PrepCountdown,
  StatusTimeline,
  SupportLinks,
} from '../components/tracking/TrackingParts';

const POLL_MS = 20_000; // web useOrderRealtime parity: realtime is the fast path, the poll the guarantee

export default function OrderTrackingScreen({ route, navigation }: { route: any; navigation: any }) {
  const orderId: string = route.params.orderId;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [courier, setCourier] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState<{ restaurant: number; courier: number }>({ restaurant: 0, courier: 0 });
  const [comment, setComment] = useState('');
  const statusRef = useRef<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const fresh = await fetchOrderDetail(orderId);
      if (!fresh) { setLoadError('Comanda nu a fost găsită.'); return; }
      statusRef.current = fresh.status;
      setOrder(fresh);
      setLoadError(null);
    } catch {
      setLoadError('Nu am putut încărca comanda. Verifică conexiunea.');
    }
  }, [orderId]);

  // Realtime row + poll fallback + refetch on foreground (no stale screen after the
  // phone was locked while the food moved).
  useEffect(() => {
    let alive = true;
    refetch();
    const unsub = subscribeOrderRow(supabase, orderId, row => {
      if (!alive) return;
      const statusChanged = typeof row.status === 'string' && row.status !== statusRef.current;
      setOrder(prev => (prev ? mergeOrderRow(prev, row) : prev));
      if (statusChanged) refetch();
    }, () => { if (alive) refetch(); });
    // Timeline rows + catering quote changes (web: order-events + catering-details channels).
    const unsubChildren = subscribeOrderChildren(supabase, orderId, () => { if (alive) refetch(); }, () => { if (alive) refetch(); });
    const poll = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (statusRef.current && isTerminal(statusRef.current)) return;
      refetch();
    }, POLL_MS);
    const appSub = AppState.addEventListener('change', s => { if (s === 'active') refetch(); });
    return () => {
      alive = false;
      unsub();
      unsubChildren();
      clearInterval(poll);
      appSub.remove();
    };
  }, [orderId, refetch]);

  const liveCourier = order != null && order.courierId != null && showsCourierOnMap(order.status);
  useEffect(() => {
    if (!liveCourier || !order?.courierId) { setCourier(null); return; }
    let cancelled = false;
    fetchCourierSeed(order.courierId).then(p => { if (!cancelled && p) setCourier(c => c ?? p); });
    const unsub = subscribeCourierLocation(supabase, orderId, p => { if (!cancelled) setCourier(p); });
    return () => { cancelled = true; unsub(); };
  }, [liveCourier, order?.courierId, orderId]);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await action();
      await refetch();
    } catch (err) {
      Alert.alert('Eroare', errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  function askCancel() {
    Alert.alert('Anulezi comanda?', 'Restaurantul nu a confirmat-o încă.', [
      { text: 'Renunță', style: 'cancel' },
      {
        text: 'Da, anulează',
        style: 'destructive',
        onPress: () => run(() => cancelOrder(supabase, asOrderId(orderId), 'Anulată de client înainte de confirmare'), 'Nu am putut anula comanda.'),
      },
    ]);
  }

  if (!order) {
    return (
      <View style={styles.center}>
        {loadError ? <Text style={styles.muted}>{loadError}</Text> : <ActivityIndicator color={COLORS.primary} />}
      </View>
    );
  }

  const tone = statusTone(order.status);
  const toneColor = tone === 'done' ? COLORS.success : tone === 'failed' ? COLORS.error : COLORS.warning;
  const step = progressIndex(order.status);
  const pickup: LatLng | null =
    order.restaurant?.lat != null && order.restaurant?.lng != null ? { lat: order.restaurant.lat, lng: order.restaurant.lng } : null;
  const routePlan = trackingRoute({ status: order.status, pickup, dropoff: order.dropoff, courier });
  const canRate = order.status === 'delivered';
  const quoted = order.catering?.quoteStatus === 'quoted';
  const failed = order.status === 'cancelled' || order.status === 'rejected';
  const carrying = order.status === 'picked_up' || order.status === 'en_route';
  const pay = paymentPresence({ method: order.paymentMethod, status: order.paymentStatus, orderStatus: order.status, amountMdl: order.totalMdl });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))} accessibilityLabel="Înapoi">
          <Ionicons name="chevron-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Comanda {order.orderNumber}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.statusBox, { borderColor: toneColor + '60' }]}>
          <Text style={[styles.statusText, { color: toneColor }]} accessibilityLiveRegion="polite">
            {order.status === 'pending_restaurant' && order.orderType === 'standard' ? 'Așteptăm confirmarea restaurantului...' : statusLabel(order.status)}
          </Text>
          <Text style={styles.muted}>{order.restaurant?.name}</Text>
          {failed && order.cancellationReason && <Text style={styles.mutedSmall}>{order.cancellationReason}</Text>}
          {showsPrepCountdown(order.status, order.estimatedReadyAt) && (
            <PrepCountdown estimatedReadyAt={order.estimatedReadyAt} status={order.status} />
          )}
        </View>

        {step >= 0 && (
          <View style={styles.rail}>
            {PROGRESS_STEPS.map((s, i) => (
              <View key={s} style={[styles.railDot, i <= step && { backgroundColor: COLORS.gold }]} />
            ))}
          </View>
        )}

        <TrackingMap pickup={pickup} dropoff={order.dropoff} courier={courier} route={routePlan} restaurantName={order.restaurant?.name} />

        {courierActive(order.status, order.courierId) && (
          <CourierCard
            name={firstName(order.courier?.firstName)}
            tel={telUrl(order.courier?.phone)}
            subtitle={carrying ? (courier ? 'Poziție live disponibilă' : 'Așteptăm semnalul GPS...') : 'Curier alocat comenzii tale'}
          />
        )}

        {order.catering && (
          <CateringStatus catering={order.catering} status={order.status} cancellationReason={order.cancellationReason} />
        )}

        {quoted && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Oferta de catering</Text>
            <Text style={styles.big}>{order.catering?.quotedTotalMdl} MDL</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              disabled={busy}
              onPress={() => run(() => confirmCateringQuote(supabase, asOrderId(orderId)), 'Nu am putut confirma oferta.')}
            >
              <Text style={styles.primaryText}>Confirmă oferta</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.card}>
          {order.items.map((it, i) => (
            <View key={i} style={styles.rowBetween}>
              <Text style={styles.itemText}>{it.quantity} × {it.name}</Text>
              <Text style={styles.itemText}>{(it.quantity * it.unitPriceMdl).toFixed(2)}</Text>
            </View>
          ))}
          <View style={styles.rowBetween}><Text style={styles.muted}>Livrare</Text><Text style={styles.muted}>{order.deliveryFeeMdl.toFixed(2)}</Text></View>
          {order.tipMdl > 0 && <View style={styles.rowBetween}><Text style={styles.muted}>Bacșiș</Text><Text style={styles.muted}>{order.tipMdl.toFixed(2)}</Text></View>}
          <View style={styles.rowBetween}>
            <Text style={[styles.total, { flex: 1 }]}>Total <Text style={styles.payLabel}>({pay.totalLabel})</Text></Text>
            <Text style={styles.total}>{order.totalMdl.toFixed(2)} MDL</Text>
          </View>
          {pay.notice && <PaymentNoticeBox notice={pay.notice} />}
          {order.dropoffText && <Text style={styles.mutedSmall}>📍 {order.dropoffText}</Text>}
        </View>

        <StatusTimeline events={order.events} />

        {customerCanTip(order.status) && order.orderType === 'standard' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Bacșiș pentru curier</Text>
            <View style={styles.chips}>
              {(['none', 'p10', 'p15', 'p20'] as TipChoice[]).map(t => (
                <TouchableOpacity
                  key={t}
                  style={styles.chip}
                  disabled={busy}
                  onPress={() => run(() => setOrderTip(supabase, asOrderId(orderId), tipAmount(order.subtotalMdl, t)), 'Nu am putut salva bacșișul.')}
                >
                  <Text style={styles.chipText}>{t === 'none' ? 'Fără' : `${t.slice(1)}% · ${tipAmount(order.subtotalMdl, t)} MDL`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {canRate && (['restaurant', 'courier'] as const).filter(t => !order.ratedTargets.includes(t) && (t === 'restaurant' || order.courierId)).map(target => (
          <View key={target} style={styles.card}>
            <Text style={styles.cardTitle}>{target === 'restaurant' ? 'Cum a fost mâncarea?' : 'Cum a fost livrarea?'}</Text>
            <View style={styles.chips}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setStars(s => ({ ...s, [target]: n }))} accessibilityLabel={`${n} stele`}>
                  <Ionicons name={n <= stars[target] ? 'star' : 'star-outline'} size={30} color={COLORS.gold} />
                </TouchableOpacity>
              ))}
            </View>
            {target === 'restaurant' && (
              <TextInput style={styles.input} placeholder="Comentariu (opțional)" placeholderTextColor={COLORS.textMuted} value={comment} onChangeText={setComment} />
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, stars[target] === 0 && { opacity: 0.4 }]}
              disabled={busy || stars[target] === 0}
              onPress={() => run(
                () => submitRating(supabase, asOrderId(orderId), target, stars[target], target === 'restaurant' ? comment.trim() || undefined : undefined),
                'Nu am putut trimite evaluarea.',
              )}
            >
              <Text style={styles.primaryText}>Trimite evaluarea</Text>
            </TouchableOpacity>
          </View>
        ))}

        {customerCanCancel(order.status) && (
          <TouchableOpacity style={styles.cancelBtn} onPress={askCancel} disabled={busy}>
            <Text style={styles.cancelText}>Anulează comanda</Text>
          </TouchableOpacity>
        )}
        {customerCanReport(order.status) && <ReportProblem orderId={orderId} />}
        <SupportLinks orderNumber={order.orderNumber} />
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: COLORS.white },
  scroll: { paddingHorizontal: 20 },
  statusBox: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12, backgroundColor: COLORS.card },
  statusText: { fontSize: 22, fontWeight: '900' },
  rail: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  railDot: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)' },
  payLabel: { color: COLORS.textSecondary, fontWeight: '500', fontSize: 13 },
  card: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, marginTop: 12, borderWidth: 1, borderColor: COLORS.cardBorder },
  cardTitle: { color: COLORS.white, fontWeight: '800', fontSize: 15, marginBottom: 10 },
  big: { color: COLORS.gold, fontSize: 24, fontWeight: '900', marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 8 },
  itemText: { color: COLORS.white, fontSize: 14 },
  total: { color: COLORS.gold, fontWeight: '800', fontSize: 16, marginTop: 4 },
  muted: { color: COLORS.textSecondary, fontSize: 14 },
  mutedSmall: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.surfaceLight },
  chipText: { color: COLORS.white, fontWeight: '600', fontSize: 13 },
  input: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, color: COLORS.white, marginBottom: 8 },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  primaryText: { color: COLORS.white, fontWeight: '800' },
  cancelBtn: { marginTop: 20, borderWidth: 1, borderColor: COLORS.error, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: COLORS.error, fontWeight: '700' },
});
