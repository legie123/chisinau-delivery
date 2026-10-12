import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { COLORS } from '../theme';
import { fetchMyPayoutAccount, savePayoutAccount, userMessage, type PayoutAccount } from '../lib/api';
import { payoutSummary, submitPayout } from '../lib/iban';

interface Props {
  courierId: string;
  onClose: () => void;
}

// IBAN for the weekly payout (replaces the dead "Cont bancar" row). Validated here with the same rule as
// the server (lib/iban.ts) so the reason is precise; the server stays the authority.
export default function PayoutAccountForm({ courierId, onClose }: Props) {
  const [current, setCurrent] = useState<PayoutAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [iban, setIban] = useState('');
  const [holder, setHolder] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMyPayoutAccount(courierId)
      .then((acc) => {
        if (!alive) return;
        setCurrent(acc);
        if (acc) setHolder(acc.holderName);
      })
      .catch((err: unknown) => {
        if (alive) Alert.alert('Contul nu s-a încărcat', userMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [courierId]);

  const save = async () => {
    setSaving(true);
    const outcome = await submitPayout(courierId, iban, holder, savePayoutAccount);
    setSaving(false);
    if (outcome.result === 'invalid') {
      Alert.alert('Verifică datele', outcome.message);
      return;
    }
    if (outcome.result === 'failed') {
      Alert.alert('Contul nu s-a salvat', outcome.message);
      return;
    }
    setCurrent(outcome.saved);
    setIban('');
    Alert.alert('Cont salvat', 'Plățile săptămânale merg în acest cont.');
  };

  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />;

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Contul pentru plăți</Text>
      <Text style={styles.hint}>
        {payoutSummary(current)}
      </Text>
      <TextInput
        style={styles.input}
        placeholder="IBAN (ex. MD24 AG00 …)"
        placeholderTextColor={COLORS.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={42}
        value={iban}
        onChangeText={setIban}
      />
      <TextInput
        style={styles.input}
        placeholder="Numele titularului"
        placeholderTextColor={COLORS.textMuted}
        autoCorrect={false}
        value={holder}
        onChangeText={setHolder}
      />
      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose} disabled={saving}>
          <Text style={styles.btnGhostText}>Închide</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { opacity: saving ? 0.5 : 1 }]} onPress={() => void save()} disabled={saving}>
          <Text style={styles.btnText}>{saving ? 'Se salvează…' : current ? 'Înlocuiește contul' : 'Salvează'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: COLORS.card, borderRadius: 16, padding: 14, marginBottom: 10, gap: 8 },
  title: { fontSize: 15, fontWeight: '800', color: COLORS.white },
  hint: { fontSize: 12, color: COLORS.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.white,
    fontSize: 14,
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 2, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.primary },
  btnText: { color: COLORS.white, fontWeight: '800', fontSize: 14 },
  btnGhost: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  btnGhostText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: 14 },
});
