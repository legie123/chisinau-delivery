import React from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

// Date + time as tap-able chips (no native date-picker dependency): the next
// `days` days and half-hour slots in a service window. Values are local
// "YYYY-MM-DD" / "HH:MM", the same strings the web <input type=date|time> yields.

const pad = (n: number) => String(n).padStart(2, '0');
const dayFmt = new Intl.DateTimeFormat('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' });

export function nextDays(days: number, from = new Date()): { value: string; label: string }[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    return { value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, label: i === 0 ? 'Azi' : i === 1 ? 'Mâine' : dayFmt.format(d) };
  });
}

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
        {nextDays(days).map(d => (
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
