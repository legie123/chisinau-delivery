import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { chosenOptions, selectionIsValid, toggleOption, type ChosenOptions, type Selection } from '@chisinau/shared-domain';
import { COLORS } from '../theme';
import type { MenuItem, OptionGroup } from '../types';

// Native twin of the web ItemModifierModal — same rules (shared-domain/cart):
// required group = at least one pick, single-pick groups replace, max_select caps.
export default function ModifierSheet({
  item,
  groups,
  onClose,
  onAdd,
  initialQty = 1,
}: {
  item: MenuItem;
  groups: OptionGroup[];
  onClose: () => void;
  onAdd: (options: ChosenOptions, quantity: number) => void;
  initialQty?: number; // catering starts at the item's minimum quantity
}) {
  const [selection, setSelection] = useState<Selection>({});
  const [qty, setQty] = useState(initialQty);
  const ref = { id: item.id, name: item.name, price_mdl: item.priceMdl };
  const chosen = chosenOptions(ref, groups, selection);
  const valid = selectionIsValid(groups, selection);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{item.name}</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Închide">
              <Ionicons name="close" size={24} color={COLORS.white} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 420 }}>
            {groups.map(g => (
              <View key={g.id} style={styles.group}>
                <Text style={styles.groupName}>
                  {g.name}{' '}
                  <Text style={g.is_required ? styles.required : styles.optional}>
                    {g.is_required ? 'OBLIGATORIU' : `opțional${g.max_select > 1 ? ` · max ${g.max_select}` : ''}`}
                  </Text>
                </Text>
                {g.options.map(o => {
                  const checked = (selection[g.id] ?? []).includes(o.id);
                  return (
                    <TouchableOpacity
                      key={o.id}
                      style={[styles.option, checked && styles.optionChecked]}
                      onPress={() => setSelection(prev => toggleOption(prev, g, o.id))}
                    >
                      <Ionicons
                        name={g.max_select === 1 ? (checked ? 'radio-button-on' : 'radio-button-off') : (checked ? 'checkbox' : 'square-outline')}
                        size={20}
                        color={checked ? COLORS.primary : COLORS.textMuted}
                      />
                      <Text style={styles.optionName}>{o.name}</Text>
                      {o.price_delta_mdl > 0 && <Text style={styles.delta}>+{o.price_delta_mdl} MDL</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            <View style={styles.stepper}>
              <TouchableOpacity onPress={() => setQty(q => Math.max(1, q - 1))} style={styles.stepBtn}>
                <Ionicons name="remove" size={18} color={COLORS.white} />
              </TouchableOpacity>
              <Text style={styles.qty}>{qty}</Text>
              <TouchableOpacity onPress={() => setQty(q => q + 1)} style={styles.stepBtn}>
                <Ionicons name="add" size={18} color={COLORS.white} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.addBtn, !valid && { opacity: 0.4 }]}
              disabled={!valid}
              onPress={() => onAdd(chosen, qty)}
            >
              <Text style={styles.addText}>Adaugă · {(chosen.unitPriceMdl * qty).toFixed(2)} MDL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: COLORS.white, fontSize: 18, fontWeight: '800', flex: 1, marginRight: 12 },
  group: { marginBottom: 16 },
  groupName: { color: COLORS.white, fontWeight: '700', marginBottom: 8 },
  required: { color: COLORS.primary, fontSize: 10, fontWeight: '800' },
  optional: { color: COLORS.textMuted, fontSize: 11, fontWeight: '400' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: COLORS.card, marginBottom: 6 },
  optionChecked: { borderWidth: 1, borderColor: COLORS.primary },
  optionName: { color: COLORS.white, flex: 1 },
  delta: { color: COLORS.gold, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center' },
  qty: { color: COLORS.white, fontWeight: '800', fontSize: 16, minWidth: 20, textAlign: 'center' },
  addBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  addText: { color: COLORS.white, fontWeight: '800' },
});
