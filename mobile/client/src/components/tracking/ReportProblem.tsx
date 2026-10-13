import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../../theme';
import { PROBLEM_KINDS } from '../../lib/orderStatus';
import { errorText, fetchMyComplaint, reportProblem, type MyComplaint } from '../../lib/api';

// Parity row 12: after acceptance the customer reports a problem from the order screen
// (customer_report_problem -> ops' complaint log + an ops alert). Shows the open/resolved state of
// the complaint already reported on this order instead of a second form.
export default function ReportProblem({ orderId }: { orderId: string }) {
  const [existing, setExisting] = useState<MyComplaint | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>('missing_item');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchMyComplaint(orderId).then(setExisting).catch(() => setExisting(null));
  }, [orderId]);
  useEffect(load, [load]);

  if (existing === undefined) return null;
  if (existing) {
    return (
      <View style={styles.box}>
        <Text style={styles.title}>Problemă raportată</Text>
        <Text style={styles.muted}>
          {existing.status === 'open' ? 'Echipa noastră o verifică și te contactează.' : 'Rezolvată — echipa te-a contactat sau te contactează.'}
        </Text>
      </View>
    );
  }
  if (!open) {
    return (
      <TouchableOpacity style={styles.linkBtn} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={styles.linkText}>Raportează o problemă cu comanda</Text>
      </TouchableOpacity>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await reportProblem(orderId, kind, note);
      setOpen(false);
      load();
    } catch (err) {
      setError(errorText(err, 'Nu am putut trimite. Încearcă din nou sau scrie-ne.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Ce s-a întâmplat?</Text>
      <View style={styles.chips}>
        {PROBLEM_KINDS.map(k => (
          <TouchableOpacity key={k.key} style={[styles.chip, kind === k.key && styles.chipOn]} onPress={() => setKind(k.key)}>
            <Text style={styles.chipText}>{k.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder="Spune-ne pe scurt (ex. lipsea sosul)"
        placeholderTextColor={COLORS.textMuted}
        value={note}
        onChangeText={setNote}
        maxLength={1000}
        multiline
        accessibilityLabel="Descrierea problemei"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity style={[styles.send, (busy || note.trim().length < 3) && { opacity: 0.5 }]} onPress={submit} disabled={busy || note.trim().length < 3}>
        {busy ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.sendText}>Trimite</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 20, marginTop: 16, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border },
  title: { color: COLORS.white, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  muted: { color: COLORS.textMuted, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, minHeight: 36 },
  chipOn: { borderColor: COLORS.gold, backgroundColor: 'rgba(245,166,35,0.12)' },
  chipText: { color: COLORS.white, fontSize: 13 },
  input: { minHeight: 64, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, padding: 10, color: COLORS.white, fontSize: 14, textAlignVertical: 'top' },
  error: { color: COLORS.primary, fontSize: 13, marginTop: 8 },
  send: { marginTop: 10, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', paddingVertical: 12, minHeight: 44 },
  sendText: { color: COLORS.white, fontWeight: '700' },
  linkBtn: { marginHorizontal: 20, marginTop: 16, paddingVertical: 12, minHeight: 44, alignItems: 'center' },
  linkText: { color: COLORS.gold, fontWeight: '600' },
});
