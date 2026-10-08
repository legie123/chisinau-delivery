import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, StatusBar, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { cancelVenueBooking, confirmVenueBooking, requestVenueBooking, type BookingPurpose } from '@chisinau/shared-api';
import { COLORS } from '../theme';
import { supabase } from '../lib/supabase';
import { errorText, fetchMyBookings, fetchVenues, isSignedIn, VENUE_LABEL, type Booking, type Venue } from '../lib/api';
import { fetchVenueContact, telUrl, type VenueContact } from '../lib/venues';
import WhenPicker from '../components/WhenPicker';

// Concierge: request a slot (request_venue_booking) -> partner quotes -> customer
// confirms (confirm_venue_booking) or cancels (cancel_venue_booking). All via shared-api.

const PURPOSE: Record<BookingPurpose, string> = { meeting: 'Ședință', dining: 'Masă', wellness: 'Wellness', event: 'Eveniment' };
const DEFAULT_PURPOSE: Record<string, BookingPurpose> = {
  business_lounge: 'meeting', spa: 'wellness', wellness_lounge: 'wellness', sushi_bar: 'dining', restaurant: 'dining',
};
const STATUS: Record<string, string> = {
  requested: 'Cerere trimisă', quoted: 'Ofertă primită', confirmed: 'Confirmată', declined: 'Refuzată', cancelled: 'Anulată', completed: 'Încheiată',
};
const DURATIONS = [1, 2, 3, 4, 8];
const when = new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Chisinau' });

export default function ConciergeScreen({ navigation }: { navigation: any }) {
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [hours, setHours] = useState(2);
  const [party, setParty] = useState('4');
  const [purpose, setPurpose] = useState<BookingPurpose>('meeting');
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState<Record<string, VenueContact>>({});

  const load = useCallback(() => {
    fetchVenues().then(setVenues).catch(() => setError('Nu am putut încărca locațiile.'));
    fetchMyBookings().then(setBookings).catch(() => {});
  }, []);
  useFocusEffect(load);

  function toggle(v: Venue) {
    setError(null);
    setOpen(o => (o === v.id ? null : v.id));
    setPurpose(DEFAULT_PURPOSE[v.venueType] ?? 'event');
    if (!contact[v.id]) {
      fetchVenueContact(v.id).then(c => setContact(prev => ({ ...prev, [v.id]: c }))).catch(() => {});
    }
  }

  // A cancel is final (cancel_venue_booking): ask once before sending it.
  function confirmCancel(b: Booking) {
    Alert.alert(
      'Anulezi rezervarea?',
      `${b.venueName} · ${when.format(new Date(b.startsAt))}. Anularea nu poate fi refăcută.`,
      [
        { text: 'Înapoi', style: 'cancel' },
        { text: 'Anulează rezervarea', style: 'destructive', onPress: () => act(() => cancelVenueBooking(supabase, b.id)) },
      ],
    );
  }

  async function request(venueId: string) {
    setError(null);
    if (!date || !time) return setError('Alege data și ora.');
    if (!person.trim() || phone.replace(/\D/g, '').length < 6) return setError('Lasă o persoană de contact și un telefon valid.');
    const start = new Date(`${date}T${time}:00`);
    if (start.getTime() <= Date.now()) return setError('Data și ora trebuie să fie în viitor.');
    if (!(await isSignedIn())) return navigation.navigate('Login');
    setBusy(true);
    try {
      await requestVenueBooking(supabase, {
        venueId,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + hours * 3_600_000).toISOString(),
        partySize: Math.max(1, parseInt(party, 10) || 1),
        purpose,
        contactPerson: person.trim(),
        contactPhone: phone.trim(),
        notes: notes.trim() || undefined,
      });
      setOpen(null);
      Alert.alert('Cerere trimisă', 'Partenerul îți trimite oferta; o confirmi de aici.');
      load();
    } catch (err) {
      setError(errorText(err, 'Nu am putut trimite cererea. Încearcă din nou.'));
    } finally {
      setBusy(false);
    }
  }

  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      load();
    } catch (err) {
      Alert.alert('Eroare', errorText(err, 'Acțiunea nu a reușit.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Înapoi">
          <Ionicons name="chevron-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Concierge</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {bookings.length > 0 && <Text style={styles.section}>Rezervările mele</Text>}
        {bookings.map(b => (
          <View key={b.id} style={styles.card}>
            <Text style={styles.name}>{b.venueName}</Text>
            <Text style={styles.muted}>{when.format(new Date(b.startsAt))} · {b.partySize} pers. · {STATUS[b.status] ?? 'Se actualizează'}</Text>
            {b.quotedPriceMdl != null && <Text style={styles.price}>{b.quotedPriceMdl} MDL</Text>}
            {b.declineReason && <Text style={styles.muted}>Motiv: {b.declineReason}</Text>}
            <View style={styles.actions}>
              {b.status === 'quoted' && (
                <TouchableOpacity style={styles.btnSmall} disabled={busy} onPress={() => act(() => confirmVenueBooking(supabase, b.id))}>
                  <Text style={styles.btnText}>Confirmă oferta</Text>
                </TouchableOpacity>
              )}
              {['requested', 'quoted', 'confirmed'].includes(b.status) && (
                <TouchableOpacity style={styles.btnGhost} disabled={busy} onPress={() => confirmCancel(b)}>
                  <Text style={styles.ghostText}>Anulează</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}

        <Text style={styles.section}>Locații</Text>
        {!venues && <ActivityIndicator color={COLORS.primary} />}
        {venues?.map(v => (
          <View key={v.id} style={styles.card}>
            <TouchableOpacity onPress={() => toggle(v)}>
              <Text style={styles.name}>{v.name}</Text>
              <Text style={styles.muted}>{VENUE_LABEL[v.venueType]}{v.sector ? ` · ${v.sector}` : ''}</Text>
              {v.description && <Text style={styles.muted} numberOfLines={2}>{v.description}</Text>}
            </TouchableOpacity>
            {open === v.id && (
              <View style={{ marginTop: 10 }}>
                {contact[v.id] && <VenueDetails c={contact[v.id]} onMenu={() => navigation.navigate('Restaurant', { restaurantId: v.id })} />}
                <WhenPicker date={date} time={time} onDate={setDate} onTime={setTime} />
                <View style={styles.chips}>
                  {DURATIONS.map(h => (
                    <TouchableOpacity key={h} style={[styles.chip, hours === h && styles.on]} onPress={() => setHours(h)}>
                      <Text style={styles.chipText}>{h === 8 ? 'toată ziua' : `${h} ${h === 1 ? 'oră' : 'ore'}`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.chips}>
                  {(Object.keys(PURPOSE) as BookingPurpose[]).map(p => (
                    <TouchableOpacity key={p} style={[styles.chip, purpose === p && styles.on]} onPress={() => setPurpose(p)}>
                      <Text style={styles.chipText}>{PURPOSE[p]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput style={styles.input} placeholder="Câte persoane" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" value={party} onChangeText={setParty} />
                <TextInput style={styles.input} placeholder="Persoană de contact" placeholderTextColor={COLORS.textMuted} value={person} onChangeText={setPerson} />
                <TextInput style={styles.input} placeholder="Telefon" placeholderTextColor={COLORS.textMuted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
                <TextInput style={styles.input} placeholder="Note (opțional)" placeholderTextColor={COLORS.textMuted} value={notes} onChangeText={setNotes} />
                {error && <Text style={styles.error}>{error}</Text>}
                <TouchableOpacity style={[styles.btn, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => request(v.id)}>
                  <Text style={styles.btnText}>Cere ofertă</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
        {error && !open && <Text style={styles.error}>{error}</Text>}
        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

function VenueDetails({ c, onMenu }: { c: VenueContact; onMenu: () => void }) {
  const tel = telUrl(c.phone);
  const where = [c.address, c.sector].filter(Boolean).join(' · ');
  return (
    <View style={styles.details}>
      {where ? (
        <View style={styles.detailRow}>
          <Ionicons name="location-outline" size={15} color={COLORS.gold} />
          <Text style={styles.detailText}>{where}</Text>
        </View>
      ) : null}
      {tel && (
        <TouchableOpacity style={styles.detailRow} onPress={() => Linking.openURL(tel).catch(() => {})} accessibilityLabel={`Sună la ${c.phone}`}>
          <Ionicons name="call-outline" size={15} color={COLORS.gold} />
          <Text style={[styles.detailText, styles.link]}>{c.phone}</Text>
        </TouchableOpacity>
      )}
      {c.orderable && (
        <TouchableOpacity style={styles.menuLink} onPress={onMenu}>
          <Text style={styles.menuLinkText}>Vezi meniul și comandă livrare →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  details: { gap: 6, marginBottom: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  detailText: { color: COLORS.textSecondary, fontSize: 13, flexShrink: 1 },
  link: { color: COLORS.gold, textDecorationLine: 'underline' },
  menuLink: { alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, marginTop: 4 },
  menuLinkText: { color: COLORS.gold, fontWeight: '700', fontSize: 13 },
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white },
  scroll: { paddingHorizontal: 20 },
  section: { color: COLORS.gold, fontWeight: '800', fontSize: 16, marginTop: 12, marginBottom: 8 },
  card: { backgroundColor: COLORS.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.cardBorder },
  name: { color: COLORS.white, fontWeight: '800', fontSize: 15 },
  muted: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  price: { color: COLORS.gold, fontWeight: '800', fontSize: 16, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.surfaceLight },
  on: { backgroundColor: COLORS.primary + '40' },
  chipText: { color: COLORS.white, fontWeight: '600', fontSize: 13 },
  input: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, color: COLORS.white, marginTop: 8 },
  error: { color: COLORS.error, fontWeight: '600', marginTop: 8 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  btnSmall: { backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnGhost: { borderWidth: 1, borderColor: COLORS.error, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnText: { color: COLORS.white, fontWeight: '800' },
  ghostText: { color: COLORS.error, fontWeight: '700' },
});
