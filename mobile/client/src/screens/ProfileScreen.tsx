import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { CustomerProfile, fetchMyProfile, signOut } from '../lib/api';

// Entries with no screen/backend behind them yet stay visible (so the menu
// doesn't look empty) but are disabled instead of firing dead onPress handlers.
const COMING_SOON_ITEMS: { icon: string; label: string; color: string }[] = [
  { icon: 'person-outline', label: 'Editează profilul', color: COLORS.primary },
  { icon: 'location-outline', label: 'Adrese salvate', color: COLORS.gold },
  { icon: 'star-outline', label: 'Restaurante favorite', color: COLORS.gold },
  { icon: 'help-circle-outline', label: 'Ajutor & Suport', color: '#60a5fa' },
  { icon: 'settings-outline', label: 'Setări', color: COLORS.textSecondary },
];

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

export default function ProfileScreen({ navigation }: { navigation: any }) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    try {
      setProfile(await fetchMyProfile());
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function handleSignOut() {
    Alert.alert('Deconectare', 'Sigur vrei să te deconectezi?', [
      { text: 'Anulează', style: 'cancel' },
      {
        text: 'Deconectare',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          await signOut();
          setSigningOut(false);
          setProfile(null);
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      {loading && (
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      )}

      {!loading && !profile && (
        <View style={styles.centerFill}>
          <Ionicons name="person-circle-outline" size={64} color={COLORS.textMuted} />
          <Text style={styles.signInPrompt}>Autentifică-te ca să-ți vezi profilul.</Text>
          <TouchableOpacity style={styles.signInBtn} onPress={() => navigation.navigate('Login', { onSignedIn: load })}>
            <Text style={styles.signInBtnText}>Autentificare</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && profile && (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.avatarSection}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(profile.fullName)}</Text>
            </View>
            <Text style={styles.userName}>{profile.fullName}</Text>
            {profile.email && <Text style={styles.userEmail}>{profile.email}</Text>}
            {profile.phone && <Text style={styles.userEmail}>{profile.phone}</Text>}
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{profile.orderCount}</Text>
              <Text style={styles.statLabel}>Comenzi</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{profile.favoriteCount}</Text>
              <Text style={styles.statLabel}>Favorite</Text>
            </View>
          </View>

          <View style={styles.menuSection}>
            {COMING_SOON_ITEMS.map((item, i) => (
              <View key={i} style={[styles.menuItem, styles.menuItemDisabled]}>
                <View style={[styles.menuIcon, { backgroundColor: item.color + '15' }]}>
                  <Ionicons name={item.icon as any} size={20} color={item.color} />
                </View>
                <Text style={[styles.menuLabel, styles.menuLabelDisabled]}>{item.label}</Text>
                <Text style={styles.comingSoon}>Curând</Text>
              </View>
            ))}
            <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={handleSignOut} disabled={signingOut}>
              <View style={[styles.menuIcon, { backgroundColor: COLORS.primary + '15' }]}>
                <Ionicons name="log-out-outline" size={20} color={COLORS.primary} />
              </View>
              <Text style={styles.menuLabel}>Deconectare</Text>
              {signingOut ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  centerFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 80,
  },
  signInPrompt: {
    color: COLORS.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  signInBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 8,
  },
  signInBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 15,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary + '30',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.primary,
  },
  userName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.white,
  },
  userEmail: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.gold,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  menuSection: {
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuItemDisabled: {
    opacity: 0.5,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
  menuLabelDisabled: {
    color: COLORS.textSecondary,
  },
  comingSoon: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
