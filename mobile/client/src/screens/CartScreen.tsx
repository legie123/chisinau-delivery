import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, StatusBar, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { placeOrder, setOrderTip } from '@chisinau/shared-api';
import { cartSubtotal, setLineQuantity } from '@chisinau/shared-domain';
import { COLORS } from '../theme';
import { clearCart, getCart, setCart, useCart } from '../lib/cart';
import { supabase } from '../lib/supabase';
import { createAddress, errorText, fetchLiveMenu, fetchMyAddresses, isSignedIn, type SavedAddress } from '../lib/api';
import { currentPosition } from '../lib/location';
import { reconcileLines, type ReconcileResult } from '@chisinau/shared-domain';
import {
  addressFingerprint,
  buildOrderInput,
  defaultAddressChoice,
  newIdempotencyKey,
  reusableAddressId,
  runExclusive,
  tipAmount,
  type CreatedAddress,
  type PaymentChoice,
  type TipChoice,
} from '../lib/checkout';

const PHONE_REQUIRED = 'Lasă un telefon de contact — curierul trebuie să te poată suna la livrare.';

interface Props {
  navigation: any;
}

const TIPS: { key: TipChoice; label: string }[] = [
  { key: 'none', label: 'Fără' },
  { key: 'p10', label: '10%' },
  { key: 'p15', label: '15%' },
  { key: 'p20', label: '20%' },
];
const PAYMENTS: { key: PaymentChoice; label: string }[] = [
  { key: 'cash', label: '💵 Cash' },
  { key: 'card_on_delivery', label: '💳 Card (POS)' },
];

export default function CartScreen({ navigation }: Props) {
  const cart = useCart();
  const [summary, setSummary] = useState<{ deliveryFee: number; minOrder: number } | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addressId, setAddressId] = useState<string>('new');
  const [street, setStreet] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [payment, setPayment] = useState<PaymentChoice>('cash');
  const [tip, setTip] = useState<TipChoice>('none');
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  // One key per checkout attempt + the address created by a failed attempt: a retry
  // returns the SAME order and reuses the SAME address row — but only while the
  // address draft is unchanged (an edited street/phone is a new row).
  const idempotencyKey = useRef(newIdempotencyKey());
  const createdAddress = useRef<CreatedAddress | null>(null);
  // Once the user picks a chip or types, the saved-address default never overrides it.
  const addressTouched = useRef(false);
  const submitLock = useRef(false);
  // Live-menu reconciliation (web useCartReconcile parity).
  const [dead, setDead] = useState<Set<string>>(new Set());
  const [repriced, setRepriced] = useState<ReconcileResult['repriced']>([]);
  const signature = cart.lines.map(l => l.lineId).sort().join('|');

  const touched = <T,>(set: (v: T) => void) => (v: T) => {
    addressTouched.current = true;
    set(v);
  };

  useEffect(() => {
    if (!cart.restaurantId) return;
    let stale = false;
    supabase
      .from('restaurants')
      .select('delivery_fee_mdl, min_order_amount_mdl')
      .eq('id', cart.restaurantId)
      .single()
      .then(({ data }) => {
        if (!stale && data) setSummary({ deliveryFee: Number(data.delivery_fee_mdl), minOrder: Number(data.min_order_amount_mdl) });
      });
    return () => { stale = true; };
  }, [cart.restaurantId]);

  useFocusEffect(
    useCallback(() => {
      fetchMyAddresses()
        .then(list => {
          setAddresses(list);
          const wasTouched = addressTouched.current;
          setAddressId(prev => defaultAddressChoice(prev, list, wasTouched));
          if (list.length > 0) addressTouched.current = true; // default applied once
        })
        .catch(() => {});
    }, []),
  );

  // The persisted cart vs the live menu: place_order charges live prices, so the
  // total shown must be the live one, and a dead line must be named, not fail blind.
  useFocusEffect(
    useCallback(() => {
      const lines = getCart().lines;
      if (lines.length === 0) return;
      let stale = false;
      fetchLiveMenu([...new Set(lines.map(l => l.menuItemId))], [...new Set(lines.flatMap(l => l.optionIds))])
        .then(live => {
          if (stale || !live) return;
          const r = reconcileLines(getCart().lines, live.items, live.options);
          if (r.repriced.length > 0) {
            setCart(prev => ({ ...prev, lines: reconcileLines(prev.lines, live.items, live.options).lines }));
            setRepriced(r.repriced);
          }
          setDead(new Set(r.dead.map(d => d.lineId)));
        })
        .catch(() => {});
      return () => { stale = true; };
    }, [signature]),
  );

  const subtotal = cartSubtotal(cart.lines);
  const deliveryFee = summary?.deliveryFee ?? 0;
  const tipMdl = tipAmount(subtotal, tip);
  const total = subtotal + deliveryFee + tipMdl;
  const belowMinimum = summary ? subtotal < summary.minOrder : false;
  const selected = addresses.find(a => a.id === addressId);
  const deadLines = cart.lines.filter(l => dead.has(l.lineId));

  async function pinLocation() {
    setLocating(true);
    const p = await currentPosition();
    setLocating(false);
    if (p) touched(setPin)(p);
    else setError('Nu am putut obține locația — verifică permisiunile.');
  }

  // The lock is taken before the first await: a double tap places ONE order and
  // creates ONE address row (the idempotency key alone surfaced a 23505 as an error).
  function submit() {
    return runExclusive(submitLock, async () => {
      setError(null);
      setPlacing(true);
      let placedId: string | null = null;
      try {
        if (!(await isSignedIn())) {
          navigation.navigate('Login');
          return;
        }
        const draft = { street, phone, notes, pin };
        const hasPhone = phone.replace(/\D/g, '').length >= 6;
        let deliveryAddressId = addressId === 'new' ? reusableAddressId(createdAddress.current, draft) : addressId;
        if (addressId === 'new' && !deliveryAddressId) {
          if (!street.trim()) return setError('Adresa este obligatorie.');
          if (!hasPhone) return setError(PHONE_REQUIRED);
          deliveryAddressId = await createAddress({ street_address: street.trim(), contact_phone: phone.trim(), notes: notes.trim(), ...(pin ?? {}) });
          createdAddress.current = { id: deliveryAddressId, fingerprint: addressFingerprint(draft) };
        } else if (selected && !selected.contact_phone) {
          if (!hasPhone) return setError(PHONE_REQUIRED);
          const { error: phoneError } = await supabase.from('addresses').update({ contact_phone: phone.trim() }).eq('id', selected.id);
          if (phoneError) throw new Error(phoneError.message);
        }

        const input = buildOrderInput(cart, {
          deliveryAddressId: deliveryAddressId!,
          paymentMethod: payment,
          idempotencyKey: idempotencyKey.current,
          notes: addressId === 'new' ? undefined : notes,
        });
        const orderId = await placeOrder(supabase, input);
        placedId = orderId;
        if (tipMdl > 0) {
          try {
            await setOrderTip(supabase, orderId, tipMdl);
          } catch {
            /* order placed; the tip can be added from the tracking screen */
          }
        }
        clearCart();
        idempotencyKey.current = newIdempotencyKey();
        createdAddress.current = null;
        navigation.replace('OrderTracking', { orderId });
      } catch (err) {
        setError(placedId ? 'Comanda a fost plasată.' : errorText(err, 'Nu am putut trimite comanda. Încearcă din nou.'));
      } finally {
        setPlacing(false);
      }
    });
  }

  if (!cart.restaurantId || cart.lines.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <Ionicons name="bag-outline" size={64} color={COLORS.textMuted} />
        <Text style={styles.emptyText}>Coșul tău este gol</Text>
        <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.emptyBtnText}>Înapoi</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const needsPhone = addressId === 'new' || (selected != null && !selected.contact_phone);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Înapoi">
          <Ionicons name="chevron-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Coșul tău</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.restaurantName}>{cart.restaurantName}</Text>

        {repriced.length > 0 && (
          <Text style={styles.notice}>
            Restaurantul a actualizat prețurile: {repriced.map(r => `${r.name} (${r.from}→${r.to} MDL)`).join(', ')}. Totalul de mai jos e cel real.
          </Text>
        )}
        {deadLines.length > 0 && (
          <Text style={styles.error}>
            {deadLines.length === 1 ? 'Un articol nu mai este disponibil' : `${deadLines.length} articole nu mai sunt disponibile`} — e marcat mai jos; șterge-l ca să poți continua.
          </Text>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Produse</Text>
          {cart.lines.map(line => (
            <View key={line.lineId} style={[styles.card, dead.has(line.lineId) && styles.cardDead]}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemName, dead.has(line.lineId) && styles.itemDead]}>{line.name}</Text>
                  {dead.has(line.lineId) && <Text style={styles.deadLabel}>Nu mai este disponibil</Text>}
                  {!!line.optionsLabel && <Text style={styles.itemOptions}>{line.optionsLabel}</Text>}
                </View>
                <Text style={styles.itemPrice}>{(line.priceMdl * line.quantity).toFixed(2)} MDL</Text>
              </View>
              <View style={styles.qtyRow}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => setCart(prev => setLineQuantity(prev, line.lineId, line.quantity - 1))}>
                  <Ionicons name="remove" size={16} color={COLORS.white} />
                </TouchableOpacity>
                <Text style={styles.qtyText}>{line.quantity}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => setCart(prev => setLineQuantity(prev, line.lineId, line.quantity + 1))}>
                  <Ionicons name="add" size={16} color={COLORS.white} />
                </TouchableOpacity>
                <TouchableOpacity style={{ marginLeft: 'auto', padding: 6 }} onPress={() => setCart(prev => setLineQuantity(prev, line.lineId, 0))}>
                  <Ionicons name="trash-outline" size={16} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Adresă livrare</Text>
          <View style={styles.chips}>
            {addresses.map(a => (
              <TouchableOpacity key={a.id} style={[styles.chip, addressId === a.id && styles.chipOn]} onPress={() => touched(setAddressId)(a.id)}>
                <Text style={styles.chipText} numberOfLines={1}>{a.street_address}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.chip, addressId === 'new' && styles.chipOn]} onPress={() => touched(setAddressId)('new')}>
              <Text style={styles.chipText}>+ Adresă nouă</Text>
            </TouchableOpacity>
          </View>
          {addressId === 'new' && (
            <>
              <TextInput style={styles.input} placeholder="Str. Ștefan cel Mare 1, ap. 5" placeholderTextColor={COLORS.textMuted} value={street} onChangeText={touched(setStreet)} />
              <TouchableOpacity style={styles.pinBtn} onPress={pinLocation} disabled={locating}>
                <Ionicons name="location" size={16} color={COLORS.gold} />
                <Text style={styles.pinText}>{locating ? 'Se caută locația...' : pin ? 'Locație fixată ✓' : 'Fixează locația exactă (opțional)'}</Text>
              </TouchableOpacity>
            </>
          )}
          {needsPhone && (
            <TextInput style={styles.input} placeholder="Telefon de contact" placeholderTextColor={COLORS.textMuted} keyboardType="phone-pad" value={phone} onChangeText={touched(setPhone)} />
          )}
          <TextInput
            style={[styles.input, { minHeight: 60 }]}
            placeholder="Note pentru curier: etaj, interfon..."
            placeholderTextColor={COLORS.textMuted}
            value={notes}
            onChangeText={touched(setNotes)}
            multiline
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Plata la livrare</Text>
          <View style={styles.chips}>
            {PAYMENTS.map(p => (
              <TouchableOpacity key={p.key} style={[styles.chip, payment === p.key && styles.chipOn]} onPress={() => setPayment(p.key)}>
                <Text style={styles.chipText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Bacșiș pentru curier</Text>
          <View style={styles.chips}>
            {TIPS.map(t => (
              <TouchableOpacity key={t.key} style={[styles.chip, tip === t.key && styles.chipOn]} onPress={() => setTip(t.key)}>
                <Text style={styles.chipText}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.rowBetween}><Text style={styles.priceLabel}>Subtotal</Text><Text style={styles.priceValue}>{subtotal.toFixed(2)} MDL</Text></View>
          <View style={styles.rowBetween}>
            <Text style={styles.priceLabel}>Livrare</Text>
            <Text style={[styles.priceValue, deliveryFee === 0 && { color: COLORS.success }]}>
              {summary ? (deliveryFee === 0 ? 'GRATIS' : `${deliveryFee.toFixed(2)} MDL`) : '...'}
            </Text>
          </View>
          {tipMdl > 0 && <View style={styles.rowBetween}><Text style={styles.priceLabel}>Bacșiș</Text><Text style={styles.priceValue}>{tipMdl.toFixed(2)} MDL</Text></View>}
          <View style={[styles.rowBetween, styles.totalRow]}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{total.toFixed(2)} MDL</Text></View>
          {belowMinimum && <Text style={styles.error}>Comanda minimă la acest restaurant este {summary?.minOrder} MDL.</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      <TouchableOpacity
        style={[styles.orderBtn, (placing || belowMinimum || !summary || deadLines.length > 0) && { opacity: 0.5 }]}
        activeOpacity={0.9}
        onPress={submit}
        disabled={placing || belowMinimum || !summary || deadLines.length > 0}
      >
        {placing ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="bag-check" size={20} color={COLORS.white} />}
        <Text style={styles.orderBtnText}>Plasează comanda · {total.toFixed(2)} MDL</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  emptyContainer: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', gap: 16 },
  emptyText: { fontSize: 18, color: COLORS.textSecondary, fontWeight: '600' },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.primary, marginTop: 8 },
  emptyBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.white },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white },
  scrollContent: { paddingHorizontal: 20 },
  restaurantName: { fontSize: 20, fontWeight: '800', color: COLORS.gold, marginBottom: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: COLORS.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.cardBorder },
  cardDead: { borderColor: COLORS.primary + '60' },
  itemDead: { textDecorationLine: 'line-through', color: COLORS.textMuted },
  deadLabel: { fontSize: 12, color: COLORS.primary, fontWeight: '700', marginTop: 2 },
  notice: { color: COLORS.gold, fontWeight: '600', marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  itemName: { fontSize: 15, fontWeight: '600', color: COLORS.white },
  itemOptions: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  itemPrice: { fontSize: 15, fontWeight: '700', color: COLORS.gold },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qtyBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center' },
  qtyText: { fontSize: 16, fontWeight: '700', color: COLORS.white, minWidth: 20, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder, maxWidth: '100%' },
  chipOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '20' },
  chipText: { color: COLORS.white, fontWeight: '600' },
  input: { backgroundColor: COLORS.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: COLORS.white, borderWidth: 1, borderColor: COLORS.cardBorder, marginTop: 8, textAlignVertical: 'top' },
  pinBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  pinText: { color: COLORS.gold, fontWeight: '600' },
  priceLabel: { fontSize: 14, color: COLORS.textSecondary },
  priceValue: { fontSize: 14, fontWeight: '600', color: COLORS.white },
  totalRow: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12, marginTop: 4 },
  totalLabel: { fontSize: 17, fontWeight: '800', color: COLORS.white },
  totalValue: { fontSize: 17, fontWeight: '800', color: COLORS.gold },
  error: { color: COLORS.error, marginTop: 10, fontWeight: '600' },
  orderBtn: {
    position: 'absolute', bottom: 30, left: 20, right: 20, backgroundColor: COLORS.primary, borderRadius: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', paddingVertical: 18, gap: 10, elevation: 8,
  },
  orderBtnText: { fontSize: 16, fontWeight: '800', color: COLORS.white },
});
