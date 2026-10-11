import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView, Alert, ActivityIndicator, RefreshControl, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { signOut, setOnline, getMyCourierProfile, fetchDeliveredOrdersCount, fetchAcceptanceRate, userMessage, CourierProfile, CourierStatus } from '../lib/api';
import PayoutAccountForm from '../components/PayoutAccountForm';
import { readSupportPhone } from '../lib/config';

const VEHICLE_LABEL: Record<string, string> = {
  bike: '🚲 Bicicletă',
  e_bike: '🔋 Bicicletă electrică',
  scooter: '🛵 Scuter',
  car: '🚗 Mașină',
  on_foot: '🚶 Pe jos',
};

const STATUS_LABEL: Record<CourierStatus, string> = {
  online: 'Activ',
  offline: 'Offline',
  on_delivery: 'Livrare activă',
};

const STATUS_COLOR: Record<CourierStatus, string> = {
  online: COLORS.success,
  offline: COLORS.textMuted,
  on_delivery: COLORS.gold,
};

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

// Only rows that do something. "Editează profilul", "Vehiculul meu", "Documente", "Program de lucru" and
// "Setări" were dead taps with a chevron (nothing behind them); they come back when they have a backend.
type MenuAction = 'payout' | 'support' | 'signout';
const MENU_ITEMS: { icon: string; label: string; color: string; action: MenuAction }[] = [
  { icon: 'card-outline', label: 'Cont bancar', color: COLORS.success, action: 'payout' },
  { icon: 'help-circle-outline', label: 'Ajutor & Suport', color: '#60a5fa', action: 'support' },
  { icon: 'log-out-outline', label: 'Deconectare', color: COLORS.primary, action: 'signout' },
];

// Metro only inlines `process.env.EXPO_PUBLIC_X` written out literally. Unset -> the support row is hidden.
const SUPPORT = readSupportPhone(process.env.EXPO_PUBLIC_SUPPORT_PHONE);

// Real courier profile (fixes mock name/vehicle/stats, finding #22 driver
// half) + a working online/offline toggle through set_courier_online_status,
// which now blocks the switch while a delivery is active (surfaced here as an
// alert instead of silently failing).
export default function ProfileScreen() {
  const [profile, setProfile] = useState<CourierProfile | null>(null);
  const [deliveries, setDeliveries] = useState(0);
  const [acceptRate, setAcceptRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reloads, setReloads] = useState(0); // pull-to-refresh re-runs the focus load
  const [payoutOpen, setPayoutOpen] = useState(false);

  // Every focus (bottom tabs stay mounted): status and counts follow the shift.
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      Promise.all([getMyCourierProfile(), fetchDeliveredOrdersCount(), fetchAcceptanceRate()])
        .then(([p, d, rate]) => {
          if (!mounted) return;
          setProfile(p);
          setDeliveries(d);
          setAcceptRate(rate);
        })
        .catch((err: unknown) => {
          if (mounted) Alert.alert('Profilul nu s-a încărcat', userMessage(err));
        })
        .finally(() => {
          if (!mounted) return;
          setLoading(false);
          setRefreshing(false);
        });
      return () => {
        mounted = false;
      };
    }, [reloads]),
  );

  // A failed step keeps the session and says what failed; „Deconectează oricum” forces it.
  const handleSignOut = async (force = false) => {
    try {
      const problem = await signOut(force);
      if (problem) {
        Alert.alert('Deconectare incompletă', problem, [
          { text: 'Renunță', style: 'cancel' },
          { text: 'Deconectează oricum', style: 'destructive', onPress: () => void handleSignOut(true) },
        ]);
      }
    } catch (err) {
      Alert.alert('Deconectare', userMessage(err));
    }
  };

  const handleToggleOnline = async () => {
    if (!profile || profile.status === 'on_delivery' || toggling) return;
    const goingOnline = profile.status !== 'online';
    setToggling(true);
    const err = await setOnline(goingOnline);
    setToggling(false);
    if (err) {
      Alert.alert('Nu s-a putut schimba statusul', err);
      return;
    }
    setProfile({ ...profile, status: goingOnline ? 'online' : 'offline' });
  };

  const displayName = profile?.fullName ?? 'Curier';
  const vehicleLabel = profile ? (VEHICLE_LABEL[profile.vehicleType] ?? profile.vehicleType) : '';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              setReloads((n) => n + 1);
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(displayName)}</Text>
          </View>
          <Text style={styles.userName}>{displayName}</Text>
          {vehicleLabel ? <Text style={styles.userVehicle}>{vehicleLabel}</Text> : null}

          {profile && (
            <TouchableOpacity
              style={[
                styles.statusBadge,
                { backgroundColor: STATUS_COLOR[profile.status] + '15', borderColor: STATUS_COLOR[profile.status] + '30' },
              ]}
              onPress={handleToggleOnline}
              disabled={profile.status === 'on_delivery' || toggling}
              activeOpacity={profile.status === 'on_delivery' ? 1 : 0.7}
            >
              {toggling ? (
                <ActivityIndicator size="small" color={STATUS_COLOR[profile.status]} />
              ) : (
                <>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[profile.status] }]} />
                  <Text style={[styles.statusText, { color: STATUS_COLOR[profile.status] }]}>
                    {STATUS_LABEL[profile.status]}
                  </Text>
                  {profile.status !== 'on_delivery' && (
                    <Ionicons name="swap-horizontal" size={13} color={STATUS_COLOR[profile.status]} />
                  )}
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{loading ? '—' : deliveries}</Text>
            <Text style={styles.statLabel}>Livrări</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{profile?.ratingAvg != null ? profile.ratingAvg.toFixed(1) : '—'}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{acceptRate != null ? `${acceptRate}%` : '—'}</Text>
            <Text style={styles.statLabel}>Accept</Text>
          </View>
        </View>

        {/* Menu */}
        <View style={styles.menuSection}>
          {payoutOpen && profile && <PayoutAccountForm courierId={profile.id} onClose={() => setPayoutOpen(false)} />}
          {MENU_ITEMS.filter((item) => item.action !== 'support' || SUPPORT).map((item) => (
            <TouchableOpacity
              key={item.action}
              style={styles.menuItem}
              activeOpacity={0.7}
              onPress={() => {
                switch (item.action) {
                  case 'payout':
                    if (profile) setPayoutOpen((o) => !o);
                    break;
                  case 'support':
                    if (SUPPORT) Linking.openURL(SUPPORT.tel).catch(() => Alert.alert('Nu s-a putut suna', SUPPORT.label));
                    break;
                  case 'signout':
                    void handleSignOut();
                    break;
                }
              }}
            >
              <View style={[styles.menuIcon, { backgroundColor: item.color + '15' }]}>
                <Ionicons name={item.icon as any} size={20} color={item.color} />
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
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
  userVehicle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 24,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
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
});
