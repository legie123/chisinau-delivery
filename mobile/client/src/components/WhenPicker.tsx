import React from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { chisinauDays } from '../lib/checkout';

// Date + time as tap-able chips (no native date-picker dependency): the next
// `days` days and half-hour slots in a service window. Values are Chișinău
// "YYYY-MM-DD" / "HH:MM" (chisinauDays), the same strings the web <input type=date|time> yields.

const pad = (n: number) => String(n).padStart(2, '0');

export function timeSlots(fromHour = 8, toHour = 22): string[] {
  const out: string[] = [];
  for (let h = fromHour; h <= toHour; h++) for (const m of [0, 30]) if (h < toHour || m === 0) out.push(`${pad(h)}:${pad(m)}`);
  return out;
}

export default function WhenPicker({
  date,
  time,
  onDate,
  onTime,
  days = 21,
}: {
  date: string;
  time: string;
  onDate: (d: string) => void;
  onTime: (t: string) => void;
  days?: number;
}) {
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {chisinauDays(days).map(d => (
          <TouchableOpacity key={d.value} style={[styles.chip, date === d.value && styles.on]} onPress={() => onDate(d.value)}>
            <Text style={styles.text}>{d.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {timeSlots().map(t => (
          <TouchableOpacity key={t} style={[styles.chip, time === t && styles.on]} onPress={() => onTime(t)}>
            <Text style={styles.text}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder },
  on: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '25' },
  text: { color: COLORS.white, fontWeight: '600' },
});
