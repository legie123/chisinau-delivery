import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { placeOrder } from '@chisinau/shared-api';
import { EMPTY_CART, addToCart, cartSubtotal, setLineQuantity, type CartState, type ChosenOptions } from '@chisinau/shared-domain';
import { COLORS } from '../theme';
import { supabase } from '../lib/supabase';
import { errorText, fetchCateringRestaurants, fetchMenu, isSignedIn, type CateringRestaurant } from '../lib/api';
import { buildCateringInput, cateringProblem } from '../lib/catering';
import { newIdempotencyKey, runExclusive } from '../lib/checkout';
import type { MenuItem, OptionGroup } from '../types';
import WhenPicker from '../components/WhenPicker';
import ModifierSheet from '../components/ModifierSheet';

// Catering is quote-first: the customer sends the request (place_order with
// order_type='catering', the SAME payload as the web CateringRequestForm), the partner
// quotes, the customer confirms the quote on the tracking screen. The selection is a
// shared-domain cart (lines carry option ids): an item with option groups is added
// through the ModifierSheet, so a required group is chosen before anything is sent.

// Catering wording for failures errorText also knows (checked first).
const CATERING_ERRORS: [string, string][] = [
  ['below minimum', 'Comanda nu atinge minimul de catering al restaurantului.'],
  ['menu item unavailable', 'Un articol din selecție nu mai este disponibil — reîncarcă.'],
  ['alege o opțiune', 'Un articol are opțiuni obligatorii — alege-le din nou înainte să trimiți cererea.'],
];

export default function CateringScreen({ route, navigation }: { route: any; navigation: any }) {
  const [restaurants, setRestaurants] = useState<CateringRestaurant[] | null>(null);
  const [restaurantId, setRestaurantId] = useState<string>(route.params?.restaurantId ?? '');
  const [items, setItems] = useState<MenuItem[]>([]);
  const [groups, setGroups] = useState<Record<string, OptionGroup[]>>({});
  const [selection, setSelection] = useState<CartState>(EMPTY_CART);
  const [customizing, setCustomizing] = useState<MenuItem | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [guests, setGuests] = useState('20');
  const [address, setAddress] = useState('');
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitLock = useRef(false);
  // One key per request attempt: a double tap / retry returns the SAME catering order.
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    fetchCateringRestaurants()
      .then(list => {
        setRestaurants(list);
        setRestaurantId(id => (list.some(r => r.id === id) ? id : list[0]?.id ?? ''));
      })
      .catch(() => setError('Nu am putut încărca restaurantele de catering.'));
  }, []);

  useEffect(() => {
    if (!restaurantId) return;
    let stale = false;
    setSelection(EMPTY_CART);
    fetchMenu(restaurantId, { catering: true })
      .then(m => {
        if (stale) return;
        setItems(m.items);
        setGroups(m.groups);
      })
      .catch(() => { if (!stale) setError('Nu am putut încărca meniul.'); });
    return () => { stale = true; };
  }, [restaurantId]);

  const restaurant = restaurants?.find(r => r.id === restaurantId) ?? null;
  const subtotal = cartSubtotal(selection.lines);
  const belowMin = restaurant?.cateringMin != null && subtotal < restaurant.cateringMin;
  const minQty = (i: MenuItem) => Math.max(1, i.cateringMinQty ?? 1);

  function add(item: MenuItem, options?: ChosenOptions, quantity = minQty(item)) {
    if (!restaurant) return;
    setSelection(s => addToCart(s, { id: restaurant.id, name: restaurant.name }, { id: item.id, name: item.name, price_mdl: item.priceMdl }, options, quantity));
  }

  function submit() {
    return runExclusive(submitLock, async () => {
      setError(null);
      const problem = cateringProblem(selection.lines, items, groups);
      if (problem) return setError(problem);
      if (!date || !address.trim() || !person.trim() || phone.replace(/\D/g, '').length < 6) {
        return setError('Data, adresa evenimentului și datele de contact sunt obligatorii.');
      }
      const requestedFor = new Date(`${date}T${time || '12:00'}:00`);
      if (requestedFor.getTime() < Date.now()) return setError('Data evenimentului nu poate fi în trecut.');

      setPending(true);
      try {
        if (!(await isSignedIn())) return navigation.navigate('Login');
        const orderId = await placeOrder(
          supabase,
          buildCateringInput({
            restaurantId,
            lines: selection.lines,
            form: { date, time, guests, address, person, phone, notes },
            requestedFor: requestedFor.toISOString(),
            idempotencyKey: idempotencyKey.current,
          }),
        );
        idempotencyKey.current = newIdempotencyKey();
        navigation.replace('OrderTracking', { orderId });
      } catch (err) {
        setError(errorText(err, 'A apărut o eroare la trimiterea cererii. Încearcă din nou.', CATERING_ERRORS));
      } finally {
        setPending(false);
      }
    });
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Înapoi">
          <Ionicons name="chevron-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Catering</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!restaurants && !error && <ActivityIndicator color={COLORS.primary} />}
        {restaurants?.length === 0 && <Text style={styles.muted}>Niciun restaurant nu primește cereri de catering acum.</Text>}
        <View style={styles.chips}>
          {restaurants?.map(r => (
            <TouchableOpacity key={r.id} style={[styles.chip, r.id === restaurantId && styles.on]} onPress={() => setRestaurantId(r.id)}>
              <Text style={styles.chipText}>{r.name}{r.cateringMin ? ` · min ${r.cateringMin} MDL` : ''}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {items.map(i => {
          const hasOptions = (groups[i.id] ?? []).length > 0;
          const lines = selection.lines.filter(l => l.menuItemId === i.id);
          const plain = hasOptions ? undefined : lines[0];
          return (
            <View key={i.id} style={styles.itemBox}>
              <View style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{i.name}</Text>
                  <Text style={styles.muted}>{i.priceMdl} MDL{i.cateringMinQty ? ` · min ${i.cateringMinQty} buc.` : ''}</Text>
                </View>
                {hasOptions ? (
                  <TouchableOpacity style={styles.optBtn} onPress={() => setCustomizing(i)}>
                    <Text style={styles.optBtnText}>Alege opțiunile</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity style={styles.step} onPress={() => plain && setSelection(s => setLineQuantity(s, plain.lineId, plain.quantity - 1))}>
                      <Ionicons name="remove" size={16} color={COLORS.white} />
                    </TouchableOpacity>
                    <Text style={styles.qty}>{plain?.quantity ?? 0}</Text>
                    <TouchableOpacity style={styles.step} onPress={() => (plain ? setSelection(s => setLineQuantity(s, plain.lineId, plain.quantity + 1)) : add(i))}>
                      <Ionicons name="add" size={16} color={COLORS.white} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
              {hasOptions && lines.map(l => (
                <View key={l.lineId} style={styles.line}>
                  <Text style={[styles.muted, { flex: 1 }]}>{l.optionsLabel || 'Fără opțiuni'} · {l.priceMdl} MDL</Text>
                  <TouchableOpacity style={styles.step} onPress={() => setSelection(s => setLineQuantity(s, l.lineId, l.quantity - 1))}>
                    <Ionicons name="remove" size={16} color={COLORS.white} />
                  </TouchableOpacity>
                  <Text style={styles.qty}>{l.quantity}</Text>
                  <TouchableOpacity style={styles.step} onPress={() => setSelection(s => setLineQuantity(s, l.lineId, l.quantity + 1))}>
                    <Ionicons name="add" size={16} color={COLORS.white} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          );
        })}

        <Text style={styles.label}>Data și ora evenimentului</Text>
        <WhenPicker date={date} time={time} onDate={setDate} onTime={setTime} days={60} />
        <Text style={styles.label}>Detalii</Text>
        <TextInput style={styles.input} placeholder="Număr de invitați" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" value={guests} onChangeText={setGuests} />
        <TextInput style={styles.input} placeholder="Adresa evenimentului" placeholderTextColor={COLORS.textMuted} value={address} onChangeText={setAddress} />
        <TextInput style={styles.input} placeholder="Persoană de contact" placeholderTextColor={COLORS.textMuted} value={person} onChangeText={setPerson} />
        <TextInput style={styles.input} placeholder="Telefon" placeholderTextColor={COLORS.textMuted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        <TextInput style={[styles.input, { minHeight: 60 }]} placeholder="Note (opțional)" placeholderTextColor={COLORS.textMuted} value={notes} onChangeText={setNotes} multiline />

        <Text style={styles.total}>Estimativ: {subtotal.toFixed(2)} MDL</Text>
        {belowMin && <Text style={styles.error}>Minimul de catering la acest restaurant este {restaurant?.cateringMin} MDL.</Text>}
        <Text style={styles.muted}>Restaurantul îți trimite oferta finală; o confirmi din ecranul comenzii.</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={[styles.btn, (pending || belowMin) && { opacity: 0.5 }]} onPress={submit} disabled={pending || belowMin}>
          {pending ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnText}>Trimite cererea</Text>}
        </TouchableOpacity>
        <View style={{ height: 60 }} />
      </ScrollView>
      {customizing && (
        <ModifierSheet
          item={customizing}
          groups={groups[customizing.id] ?? []}
          initialQty={minQty(customizing)}
          onClose={() => setCustomizing(null)}
          onAdd={(options, qty) => {
            const item = customizing;
            setCustomizing(null);
            add(item, options, qty);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white },
  scroll: { paddingHorizontal: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder },
  on: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '25' },
  chipText: { color: COLORS.white, fontWeight: '600' },
  itemBox: { backgroundColor: COLORS.card, borderRadius: 12, padding: 12, marginBottom: 8, gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 8 },
  optBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.primary },
  optBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  itemName: { color: COLORS.white, fontWeight: '700' },
  step: { width: 30, height: 30, borderRadius: 8, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center' },
  qty: { color: COLORS.white, fontWeight: '800', minWidth: 26, textAlign: 'center' },
  label: { color: COLORS.textSecondary, fontWeight: '700', textTransform: 'uppercase', fontSize: 12, marginTop: 18, marginBottom: 4 },
  input: { backgroundColor: COLORS.card, borderRadius: 12, padding: 12, color: COLORS.white, marginTop: 8, textAlignVertical: 'top' },
  total: { color: COLORS.gold, fontWeight: '800', fontSize: 16, marginTop: 16 },
  muted: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4 },
  error: { color: COLORS.error, fontWeight: '600', marginTop: 8 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  btnText: { color: COLORS.white, fontWeight: '800', fontSize: 16 },
});
