import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

// Heart toggle (web FavoriteButton): 44x44 hit box, 36 drawn circle.
export default function FavoriteHeart({ active, onPress, style }: { active: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? 'Elimină din favorite' : 'Adaugă la favorite'}
      style={[styles.box, style]}
    >
      <View style={styles.circle}>
        <Ionicons name={active ? 'heart' : 'heart-outline'} size={19} color={active ? COLORS.gold : 'rgba(255,255,255,0.75)'} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  circle: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
});
