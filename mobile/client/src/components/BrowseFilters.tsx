import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme';
import { BROWSE_CATEGORIES, SORTS, type BrowseFilter } from '../lib/browse';

// Category chips + "Deschis acum" + sort — the web RestaurantBrowser controls.
export default function BrowseFilters({ value, onChange }: { value: BrowseFilter; onChange: (next: BrowseFilter) => void }) {
  const set = (patch: Partial<BrowseFilter>) => onChange({ ...value, ...patch });
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {BROWSE_CATEGORIES.map(c => {
          const on = value.category === c.key;
          return (
            <TouchableOpacity
              key={c.key}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityState={{ selected: on }}
              onPress={() => set({ category: c.key })}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.emoji} {c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={[styles.row, styles.wrapRow]}>
        <TouchableOpacity
          style={[styles.chip, value.openNowOnly && styles.openOn]}
          accessibilityState={{ selected: value.openNowOnly }}
          onPress={() => set({ openNowOnly: !value.openNowOnly })}
        >
          <Text style={[styles.chipText, value.openNowOnly && styles.openTextOn]}>🟢 Deschis acum</Text>
        </TouchableOpacity>
        <View style={styles.sortGroup}>
          {SORTS.map(s => {
            const on = value.sort === s.key;
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.sort, on && styles.chipOn]}
                accessibilityLabel={`Sortează: ${s.label}`}
                accessibilityState={{ selected: on }}
                onPress={() => set({ sort: s.key })}
              >
                <Text style={[styles.sortText, on && styles.chipTextOn]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrapRow: { flexWrap: 'wrap' }, // narrow phones: sort drops under the open-now chip
  chip: {
    minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center',
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: COLORS.white },
  openOn: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  openTextOn: { color: '#18181b' },
  sortGroup: {
    marginLeft: 'auto', flexDirection: 'row', gap: 2, padding: 3, borderRadius: 20,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  sort: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16 },
  sortText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
});
