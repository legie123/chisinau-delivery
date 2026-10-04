import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { placeOrder } from '@chisinau/shared-api';
import { COLORS } from '../theme';
import { supabase } from '../lib/supabase';
import { fetchCateringRestaurants, fetchMenu, isSignedIn, type CateringRestaurant } from '../lib/api';
import type { MenuItem } from '../types';
import WhenPicker from '../components/WhenPicker';

// Catering is quote-first: the customer sends the request (place_order with
// order_type='catering', the SAME payload as the web CateringRequestForm), the partner
// quotes, the customer confirms the quote on the tracking screen.

const FRIENDLY: [string, string][] = [
  ['below minimum', 'Comanda nu atinge minimul de catering al restaurantului.'],
  ['not currently accepting orders', 'Restaurantul nu acceptă comenzi momentan.'],
  ['menu item unavailable', 'Un articol din selecție nu mai este disponibil — reîncarcă.'],
  ['invalid quantity', 'Cantitate invalidă pentru unul dintre articole.'],
];

export default function CateringScreen({ route, navigation }: { route: any; navigation: any }) {
  const [restaurants, setRestaurants] = useState<CateringRestaurant[] | null>(null);
  const [restaurantId, setRestaurantId] = useState<string>(route.params?.restaurantId ?? '');
  const [items, setItems] = useState<MenuItem[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [guests, setGuests] = useState('20');
  const [address, setAddress] = useState('');
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    setQty({});
    fetchMenu(restaurantId, { catering: true })
      .then(m => { if (!stale) setItems(m.items); })
      .catch(() => { if (!stale) setError('Nu am putut încărca meniul.'); });
    return () => { stale = true; };
  }, [restaurantId]);

  const restaurant = restaurants?.find(r => r.id === restaurantId) ?? null;
  const subtotal = useMemo(() => items.reduce((s, i) => s + (qty[i.id] ?? 0) * i.priceMdl, 0), [items, qty]);
  const belowMin = restaurant?.cateringMin != null && subtotal < restaurant.cateringMin;

  async function submit() {
    setError(null);
    const selected = items.filter(i => (qty[i.id] ?? 0) > 0);
    if (selected.length === 0) return setError('Alege cel puțin un articol pentru eveniment.');
    const under = selected.find(i => i.cateringMinQty != null && (qty[i.id] ?? 0) < i.cateringMinQty);
    if (under) return setError(`„${under.name}" se comandă de la minim ${under.cateringMinQty} buc.`);
    if (!date || !address.trim() || !person.trim() || phone.replace(/\D/g, '').length < 6) {
      return setError('Data, adresa evenimentului și datele de contact sunt obligatorii.');
    }
    if (!(await isSignedIn())) return navigation.navigate('Login');
    const requestedFor = new Date(`${date}T${time || '12:00'}:00`);
    if (requestedFor.getTime() < Date.now()) return setError('Data evenimentului nu poate fi în trecut.');

    setPending(true);
    try {
      const orderId = await placeOrder(supabase, {
        restaurantId,
        orderType: 'catering',
        paymentMethod: 'cash',
        items: selected.map(i => ({ menu_item_id: i.id, quantity: qty[i.id] })),
        requestedFor: requestedFor.toISOString(),
        notes: notes.trim() || undefined,
        catering: {
          event_date: date,
          event_time: time || '',
          guest_count: Math.max(1, parseInt(guests, 10) || 1),
          event_address_text: address.trim(),
          contact_person: person.trim(),
          contact_phone: phone.trim(),
        },
      });
      navigation.replace('OrderTracking', { orderId });
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      setError(FRIENDLY.find(([n]) => raw.includes(n))?.[1] ?? 'A apărut o eroare la trimiterea cererii. Încearcă din nou.');
    } finally {
      setPending(false);
    }
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

        {items.map(i => (
          <View key={i.id} style={styles.item}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{i.name}</Text>
              <Text style={styles.muted}>{i.priceMdl} MDL{i.cateringMinQty ? ` · min ${i.cateringMinQty} buc.` : ''}</Text>
            </View>
            <TouchableOpacity style={styles.step} onPress={() => setQty(q => ({ ...q, [i.id]: Math.max(0, (q[i.id] ?? 0) - 1) }))}>
              <Ionicons name="remove" size={16} color={COLORS.white} />
            </TouchableOpacity>
            <Text style={styles.qty}>{qty[i.id] ?? 0}</Text>
            <TouchableOpacity style={styles.step} onPress={() => setQty(q => ({ ...q, [i.id]: (q[i.id] ?? 0) + (q[i.id] ? 1 : Math.max(1, i.cateringMinQty ?? 1)) }))}>
              <Ionicons name="add" size={16} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        ))}

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
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.card, borderRadius: 12, padding: 12, marginBottom: 8 },
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
