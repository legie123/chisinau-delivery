import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, StatusBar, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import {
  addressUsedByOrder,
  createAddress,
  deleteAddress,
  errorText,
  fetchAddressBook,
  setDefaultAddress,
  updateAddress,
  type AddressBookEntry,
} from '../lib/api';
import { ADDRESS_SAVED_AS_NEW, addressDraftProblem, addressEditPlan, addressRow, addressSaveProblem, runExclusive, type AddressFields } from '../lib/checkout';
import PinPicker from '../components/PinPicker';

// Profile → Adrese salvate: list, add, edit, delete, choose the default the checkout
// preselects. Same fields the web checkout saves (sector / bloc / apartament) + label.

/** The web checkout's extra address fields, shared with CartScreen's "Adresă nouă". */
export function AddressFieldsForm({
  value,
  onChange,
}: {
  value: AddressFields & { street: string };
  onChange: (field: keyof AddressFields | 'street', text: string) => void;
}) {
  const field = (key: keyof AddressFields | 'street', placeholder: string, style?: object) => (
    <TextInput
      style={[styles.input, style]}
      placeholder={placeholder}
      placeholderTextColor={COLORS.textMuted}
      value={value[key] ?? ''}
      onChangeText={t => onChange(key, t)}
      accessibilityLabel={placeholder}
    />
  );
  return (
    <>
      {field('street', 'Stradă, număr')}
      <View style={styles.row3}>
        {field('sector', 'Sector', styles.flex)}
        {field('building', 'Bloc', styles.flex)}
        {field('apartment', 'Apartament', styles.flex)}
      </View>
      {/* Parity row 3: the courier is told exactly where to go up (floor required with an apartment). */}
      <View style={styles.row3}>
        {field('entrance', 'Scara', styles.flex)}
        {field('floor', value.apartment?.trim() ? 'Etaj (obligatoriu)' : 'Etaj', styles.flex)}
        {field('intercom', 'Interfon', styles.flex)}
      </View>
      {field('label', 'Etichetă (ex. Acasă, Birou) — opțional')}
    </>
  );
}

type Draft = Required<AddressFields> & { street: string; phone: string; notes: string; pin: { lat: number; lng: number } | null };
const EMPTY: Draft = { street: '', sector: '', building: '', apartment: '', entrance: '', floor: '', intercom: '', label: '', phone: '', notes: '', pin: null };

function toDraft(a: AddressBookEntry): Draft {
  return {
    street: a.street_address,
    sector: a.sector ?? '',
    building: a.building ?? '',
    apartment: a.apartment ?? '',
    entrance: a.entrance ?? '',
    floor: a.floor ?? '',
    intercom: a.intercom_code ?? '',
    label: a.label ?? '',
    phone: a.contact_phone ?? '',
    notes: a.notes ?? '',
    pin: a.lat != null && a.lng != null ? { lat: Number(a.lat), lng: Number(a.lng) } : null,
  };
}

export function addressLine(a: { street_address: string; sector?: string | null; building?: string | null; apartment?: string | null; entrance?: string | null; floor?: string | null }): string {
  return [a.street_address, a.building && `bl. ${a.building}`, a.entrance && `sc. ${a.entrance}`, a.floor && `et. ${a.floor}`, a.apartment && `ap. ${a.apartment}`, a.sector && `sect. ${a.sector}`].filter(Boolean).join(', ');
}

export default function AddressesScreen({ navigation }: { navigation: any }) {
  const [list, setList] = useState<AddressBookEntry[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  // null = list view; 'new' = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const load = useCallback(async () => {
    try {
      setList(await fetchAddressBook());
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = (fn: () => Promise<void>, fallback: string) =>
    runExclusive(lock, async () => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await load();
      } catch (err) {
        setError(errorText(err, fallback));
      } finally {
        setBusy(false);
      }
    });

  function startEdit(a: AddressBookEntry) {
    setError(null);
    setDraft(toDraft(a));
    setEditing(a.id);
  }

  function save() {
    const d = draft;
    const problem = addressDraftProblem(d);
    if (problem) return setError(problem);
    const target = editing;
    const before = list.find(a => a.id === target);
    const stale = before ? addressSaveProblem(before, d) : null;
    if (stale) return setError(stale);
    return run(async () => {
      if (target === 'new') await createAddress(addressRow(d));
      else if (target && before) {
        // Read at save time, not when the form opened: an order placed meanwhile counts.
        const plan = addressEditPlan(before, d, await addressUsedByOrder(target));
        if (plan.kind === 'update') await updateAddress(target, plan.patch);
        else {
          const id = await createAddress(plan.row);
          setEditing(null); // saved: a retry from here would insert a second copy
          Alert.alert('Adresă salvată ca nouă', ADDRESS_SAVED_AS_NEW);
          if (plan.makeDefault) {
            try {
              await setDefaultAddress(id);
            } catch {
              setError('Adresa nouă a fost salvată, dar nu am putut-o face implicită — atinge «Implicită».');
            }
          }
        }
      }
      setEditing(null);
    }, 'Nu am putut salva adresa.');
  }

  function confirmDelete(a: AddressBookEntry) {
    Alert.alert('Ștergi adresa?', addressLine(a), [
      { text: 'Renunță', style: 'cancel' },
      { text: 'Șterge', style: 'destructive', onPress: () => run(() => deleteAddress(a.id), 'Nu am putut șterge adresa.') },
    ]);
  }

  const set = (field: Exclude<keyof Draft, 'pin'>, text: string) => setDraft(d => ({ ...d, [field]: text }));

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (editing ? setEditing(null) : navigation.goBack())} accessibilityLabel="Înapoi">
          <Ionicons name="chevron-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{editing === 'new' ? 'Adresă nouă' : editing ? 'Editează adresa' : 'Adrese salvate'}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing ? (
          <>
            <AddressFieldsForm value={draft} onChange={set} />
            <PinPicker value={draft.pin} onChange={pin => setDraft(d => ({ ...d, pin }))} />
            <TextInput style={styles.input} placeholder="Telefon de contact" placeholderTextColor={COLORS.textMuted} keyboardType="phone-pad" value={draft.phone} onChangeText={t => set('phone', t)} />
            <TextInput style={[styles.input, { minHeight: 60 }]} placeholder="Note pentru curier: reper, poartă, câine..." placeholderTextColor={COLORS.textMuted} value={draft.notes} onChangeText={t => set('notes', t)} multiline />
            {error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.5 }]} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.primaryText}>Salvează</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            {state === 'loading' && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />}
            {state === 'error' && (
              <TouchableOpacity onPress={load}>
                <Text style={styles.muted}>Nu am putut încărca adresele. Atinge pentru a reîncerca.</Text>
              </TouchableOpacity>
            )}
            {state === 'ready' && list.length === 0 && <Text style={styles.muted}>Nu ai nicio adresă salvată încă.</Text>}
            {list.map(a => (
              <View key={a.id} style={[styles.card, a.is_default && styles.cardDefault]}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{a.label || 'Adresă'}{a.is_default ? ' · implicită' : ''}</Text>
                    <Text style={styles.cardLine}>{addressLine(a)}</Text>
                    {!!a.contact_phone && <Text style={styles.cardMeta}>{a.contact_phone}</Text>}
                  </View>
                </View>
                <View style={styles.actions}>
                  {!a.is_default && (
                    <TouchableOpacity style={styles.action} disabled={busy} onPress={() => run(() => setDefaultAddress(a.id), 'Nu am putut seta adresa implicită.')}>
                      <Ionicons name="star-outline" size={15} color={COLORS.gold} />
                      <Text style={styles.actionText}>Implicită</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.action} disabled={busy} onPress={() => startEdit(a)}>
                    <Ionicons name="create-outline" size={15} color={COLORS.white} />
                    <Text style={styles.actionText}>Editează</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.action} disabled={busy} onPress={() => confirmDelete(a)}>
                    <Ionicons name="trash-outline" size={15} color={COLORS.primary} />
                    <Text style={[styles.actionText, { color: COLORS.primary }]}>Șterge</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {error && <Text style={styles.error}>{error}</Text>}
            {state === 'ready' && (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => { setError(null); setDraft(EMPTY); setEditing('new'); }}>
                <Ionicons name="add" size={18} color={COLORS.white} />
                <Text style={styles.primaryText}>Adaugă adresă</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white },
  content: { paddingHorizontal: 20, paddingBottom: 60 },
  muted: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: COLORS.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.cardBorder },
  cardDefault: { borderColor: COLORS.gold + '60' },
  cardTop: { flexDirection: 'row' },
  cardTitle: { color: COLORS.gold, fontWeight: '800', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardLine: { color: COLORS.white, fontSize: 15, fontWeight: '600', marginTop: 4 },
  cardMeta: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  actionText: { color: COLORS.white, fontWeight: '600', fontSize: 13 },
  input: { backgroundColor: COLORS.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: COLORS.white, borderWidth: 1, borderColor: COLORS.cardBorder, marginTop: 8, textAlignVertical: 'top' },
  row3: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  error: { color: COLORS.error, marginTop: 12, fontWeight: '600' },
  primaryBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15, marginTop: 18 },
  primaryText: { color: COLORS.white, fontWeight: '800', fontSize: 15 },
});
