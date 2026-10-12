import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SERIF } from '../theme';

// Termeni și condiții + Politica de confidențialitate — the same text as the web pages
// src/app/(customer)/termeni and /confidentialitate. Change both together.

export const SUPPORT_EMAIL = 'contact@dragonsdelivery.md';

type Block = { h: string; p?: string[]; rows?: [string, string][]; note?: string; mail?: boolean };
type Doc = { title: string; updated: string; blocks: Block[] };

const DOCS: Record<'terms' | 'privacy', Doc> = {
  terms: {
    title: 'Termeni și condiții',
    updated: 'Ultima actualizare: iulie 2026',
    blocks: [
      {
        h: '1. Serviciul',
        p: ['Dragons Delivery (operat de Dragons Alliance SRL, Chișinău) este o platformă de intermediere care conectează clienți, restaurante partenere și curieri pentru livrarea de mâncare și servicii de catering în Chișinău.'],
      },
      {
        h: '2. Comenzi și plăți',
        p: ['Prețurile sunt afișate în lei moldovenești (MDL) și includ taxa de livrare acolo unde se aplică. În etapa pilot plata se face la livrare — numerar sau card la POS-ul curierului. Confirmarea comenzii nu garantează disponibilitatea; restaurantul poate refuza o comandă, caz în care nu se percepe nicio sumă.'],
      },
      {
        h: '3. Anulare',
        p: ['O comandă poate fi anulată de client înainte de confirmarea restaurantului. După confirmare, anularea se face doar prin suport, conform politicii comerciale.'],
      },
      { h: '4. Contact', p: ['Pentru orice întrebare:'], mail: true },
    ],
  },
  privacy: {
    title: 'Politica de confidențialitate',
    updated: 'Ultima actualizare: iulie 2026',
    blocks: [
      {
        h: 'Ce date colectăm',
        p: ['Colectăm datele necesare livrării: nume, telefon, adresă de livrare (inclusiv cod interfon și instrucțiuni de acces, dacă le oferi), coordonate GPS și istoricul comenzilor. În etapa pilot plata se face la livrare (numerar sau card la POS-ul curierului) — nu colectăm și nu stocăm datele cardului.'],
      },
      {
        h: 'Cum le folosim',
        p: ['Datele sunt folosite exclusiv pentru procesarea și livrarea comenzilor, suport și îmbunătățirea serviciului. Adresa și poziția ta sunt partajate cu curierul alocat doar pe durata livrării active.'],
      },
      {
        h: 'Cât timp păstrăm datele',
        p: ['Publicăm ferestrele exacte de retenție — puțini o fac. Ștergerea rulează automat, zilnic:'],
        rows: [
          ['Poziția GPS a curierului', '2 ani'],
          ['Cod interfon + note de livrare (client inactiv)', '1 an'],
          ['Cont inactiv (fără comenzi) → anonimizat', '3 ani'],
          ['Istoric comenzi (evidențe fiscale obligatorii)', '10 ani'],
        ],
        note: 'Ștergerea unui cont anonimizează datele personale (nume, telefon, adresă), dar păstrează comenzile în formă anonimă — legislația fiscală impune păstrarea 10 ani.',
      },
      {
        h: 'Drepturile tale',
        p: ['Poți solicita accesul, corectarea sau ștergerea datelor tale scriind la'],
        mail: true,
        note: 'La cerere îți anonimizăm datele personale (nume, telefon, adresă), păstrând comenzile doar în formă anonimă pentru evidențele financiare obligatorii.',
      },
    ],
  },
};

export default function LegalScreen({ navigation, route }: { navigation: any; route: any }) {
  const doc = DOCS[route.params?.doc === 'privacy' ? 'privacy' : 'terms'];
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Înapoi">
          <Ionicons name="chevron-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{doc.title}</Text>
        <Text style={styles.updated}>{doc.updated}</Text>
        {doc.blocks.map(b => (
          <View key={b.h} style={styles.block}>
            <Text style={styles.h}>{b.h}</Text>
            {b.p?.map(t => <Text key={t} style={styles.p}>{t}</Text>)}
            {b.mail && (
              <Text style={styles.link} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {})}>{SUPPORT_EMAIL}</Text>
            )}
            {b.rows?.map(([k, v]) => (
              <View key={k} style={styles.row}>
                <Text style={[styles.p, { flex: 1 }]}>{k}</Text>
                <Text style={styles.rowValue}>{v}</Text>
              </View>
            ))}
            {b.note && <Text style={[styles.p, styles.note]}>{b.note}</Text>}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  content: { paddingHorizontal: 20, paddingBottom: 60 },
  title: { fontFamily: SERIF, fontSize: 28, fontWeight: '700', color: COLORS.gold },
  updated: { fontSize: 13, color: COLORS.textMuted, marginTop: 6, marginBottom: 20 },
  block: { marginBottom: 22 },
  h: { fontSize: 16, fontWeight: '700', color: COLORS.white, marginBottom: 6 },
  p: { fontSize: 15, lineHeight: 22, color: COLORS.textSecondary },
  link: { fontSize: 15, color: COLORS.gold, textDecorationLine: 'underline', marginTop: 4 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowValue: { fontSize: 15, fontWeight: '600', color: COLORS.gold },
  note: { fontSize: 13, color: COLORS.textMuted, marginTop: 10 },
});
