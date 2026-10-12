import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { apiClient, performLogout, API_BASE_URL, fetchMeAndSyncTeam } from '../src/api/client';
import { useAuthStore } from '../src/state/auth';
import { useTeamStore, ClinicSummary } from '../src/state/team';
import { getStoredRefreshToken, getOrCreateDeviceId } from '../src/storage/secure-store';
import { colors, spacing, radii, typography } from '../src/theme/tokens';
import { BottomNav } from '../src/components/BottomNav';

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeRole = useTeamStore((state) => state.activeRole);
  const clinics = useTeamStore((state) => state.clinics);
  const setActiveTeam = useTeamStore((state) => state.setActiveTeam);

  const [loggingOut, setLoggingOut] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [switcherVisible, setSwitcherVisible] = useState(false);

  const [initialLoading, setInitialLoading] = useState(true);

  // Sync clinics on load cleanly without race-condition redirect
  useEffect(() => {
    let isMounted = true;
    fetchMeAndSyncTeam()
      .then(({ clinics: freshClinics }) => {
        if (!isMounted) return;
        if (freshClinics.length === 0) {
          router.replace('/create-clinic' as any);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setInitialLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [router]);

  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const isOwner = activeRole === 'OWNER';
  const isManager = activeRole === 'MANAGER';
  const canManage = isOwner || isManager;

  const handleLogout = async () => {
    setLoggingOut(true);
    setErrorMessage(null);

    try {
      const refreshToken = await getStoredRefreshToken();
      if (refreshToken) {
        await apiClient.post(`${API_BASE_URL}/v1/auth/logout`, { refreshToken }).catch(() => {});
      }
    } finally {
      await performLogout();
      setLoggingOut(false);
      router.replace('/');
    }
  };

  const handleLogoutAll = async () => {
    setLoggingOutAll(true);
    setErrorMessage(null);

    try {
      const deviceId = await getOrCreateDeviceId();
      await apiClient.post(`${API_BASE_URL}/v1/auth/logout-all`, { deviceId });
      await performLogout();
      router.replace('/');
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
        setErrorMessage(err.response.data.error.message);
      } else {
        setErrorMessage('Unable to log out from all devices. Please try again.');
      }
    } finally {
      setLoggingOutAll(false);
    }
  };

  const handleSelectClinic = (clinic: ClinicSummary) => {
    setActiveTeam(clinic.id, clinic.role);
    setSwitcherVisible(false);
  };

  if (initialLoading && clinics.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading clinic workspace...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Header / Clinic Switcher */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.clinicPickerButton}
            onPress={() => {
              if (clinics.length > 1) {
                setSwitcherVisible(true);
              }
            }}
            disabled={clinics.length <= 1}
            activeOpacity={0.7}
          >
            <View style={styles.clinicPickerLeft}>
              <View style={styles.clinicDot} />
              <Text style={styles.clinicNameText} numberOfLines={1}>
                {activeClinic?.name || 'My Clinic'}
              </Text>
            </View>
            {clinics.length > 1 && (
              <View style={styles.switchBadge}>
                <Text style={styles.switchBadgeText}>Switch ▾</Text>
              </View>
            )}
          </TouchableOpacity>

          <View
            style={[
              styles.roleBadge,
              activeRole === 'OWNER' && styles.roleBadgeOwner,
              activeRole === 'MANAGER' && styles.roleBadgeManager,
            ]}
          >
            <Text
              style={[
                styles.roleBadgeText,
                activeRole === 'OWNER' && styles.roleBadgeTextOwner,
                activeRole === 'MANAGER' && styles.roleBadgeTextManager,
              ]}
            >
              {activeRole || 'MEMBER'}
            </Text>
          </View>
        </View>

        {/* Welcome Section */}
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeTitle}>Welcome, {user?.name || 'Staff'}</Text>
          <Text style={styles.welcomeSubtitle}>
            {user?.email} • Time Zone: {activeClinic?.timeZone || 'Africa/Lagos'}
          </Text>
        </View>

        {/* Quick Actions Grid */}
        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/my-shifts' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.actionCardHeader}>
              <Text style={styles.actionCardTag}>MY SHIFTS</Text>
              <Text style={styles.actionCardArrow}>→</Text>
            </View>
            <Text style={styles.actionCardTitle}>My Upcoming Shifts</Text>
            <Text style={styles.actionCardDesc}>
              View your next 14 days of shifts across all clinics with clash detection.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/calendar' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.actionCardHeader}>
              <Text style={[styles.actionCardTag, { backgroundColor: '#e0e7ff', color: '#3730a3' }]}>
                CALENDAR
              </Text>
              <Text style={styles.actionCardArrow}>→</Text>
            </View>
            <Text style={styles.actionCardTitle}>Clinic Shift Rota</Text>
            <Text style={styles.actionCardDesc}>
              Week view of shifts, draft manager approvals, and day schedules.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/swaps' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.actionCardHeader}>
              <Text style={[styles.actionCardTag, { backgroundColor: '#dcfce7', color: '#15803d' }]}>
                SWAPS
              </Text>
              <Text style={styles.actionCardArrow}>→</Text>
            </View>
            <Text style={styles.actionCardTitle}>Shift Swaps Inbox</Text>
            <Text style={styles.actionCardDesc}>
              Incoming, outgoing, and manager sign-off on shift swap proposals.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/team' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.actionCardHeader}>
              <Text style={styles.actionCardTag}>ROSTER</Text>
              <Text style={styles.actionCardArrow}>→</Text>
            </View>
            <Text style={styles.actionCardTitle}>Team & Roles</Text>
            <Text style={styles.actionCardDesc}>
              View staff directory, manage member permissions, and track active invites.
            </Text>
          </TouchableOpacity>

          {canManage && (
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/invite' as any)}
              activeOpacity={0.8}
            >
              <View style={styles.actionCardHeader}>
                <Text style={[styles.actionCardTag, styles.actionCardTagInvite]}>
                  INVITATIONS
                </Text>
                <Text style={styles.actionCardArrow}>→</Text>
              </View>
              <Text style={styles.actionCardTitle}>Invite Members</Text>
              <Text style={styles.actionCardDesc}>
                Create sharable links for Manager or Staff roles with seat limits.
              </Text>
            </TouchableOpacity>
          )}

          {isOwner && (
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/billing' as any)}
              activeOpacity={0.8}
            >
              <View style={styles.actionCardHeader}>
                <Text style={[styles.actionCardTag, { backgroundColor: '#fef3c7', color: '#b45309' }]}>
                  BILLING
                </Text>
                <Text style={styles.actionCardArrow}>→</Text>
              </View>
              <Text style={styles.actionCardTitle}>Plan & Billing</Text>
              <Text style={styles.actionCardDesc}>
                View plan, seats, next renewal date, and change your subscription tier.
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.actionCardSecondary}
            onPress={() => router.push('/create-clinic' as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.actionCardSecondaryText}>+ Add another Clinic</Text>
          </TouchableOpacity>
        </View>

        {/* Session & Logout Section */}
        <View style={styles.logoutSection}>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            disabled={loggingOut || loggingOutAll}
            activeOpacity={0.8}
          >
            {loggingOut ? (
              <ActivityIndicator color={colors.onSurface} />
            ) : (
              <Text style={styles.logoutButtonText}>Log Out</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.logoutAllButton}
            onPress={handleLogoutAll}
            disabled={loggingOut || loggingOutAll}
            activeOpacity={0.8}
          >
            {loggingOutAll ? (
              <ActivityIndicator color={colors.onError} />
            ) : (
              <Text style={styles.logoutAllButtonText}>Log out of all devices</Text>
            )}
          </TouchableOpacity>

          {errorMessage && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}
        </View>

        {/* Clinic Switcher Modal */}
        <Modal
          visible={switcherVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSwitcherVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Switch Clinic</Text>
              <Text style={styles.modalSubtitle}>
                Select the clinic workspace you want to view:
              </Text>

              {clinics.map((clinic) => {
                const isSelected = clinic.id === activeClinic?.id;
                return (
                  <TouchableOpacity
                    key={clinic.id}
                    style={[styles.clinicOption, isSelected && styles.clinicOptionActive]}
                    onPress={() => handleSelectClinic(clinic)}
                  >
                    <View style={styles.clinicOptionInfo}>
                      <Text
                        style={[
                          styles.clinicOptionName,
                          isSelected && styles.clinicOptionNameActive,
                        ]}
                      >
                        {clinic.name}
                      </Text>
                      <Text style={styles.clinicOptionRole}>
                        Role: {clinic.role} • {clinic.timeZone}
                      </Text>
                    </View>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                style={styles.newClinicModalButton}
                onPress={() => {
                  setSwitcherVisible(false);
                  router.push('/create-clinic' as any);
                }}
              >
                <Text style={styles.newClinicModalText}>+ Create New Clinic</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setSwitcherVisible(false)}
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ScrollView>
      <BottomNav currentTab="home" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
  },
  scrollContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    marginBottom: spacing.xl,
  },
  clinicPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.md,
  },
  clinicPickerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '70%',
  },
  clinicDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  clinicNameText: {
    ...typography.headlineMedium,
    fontSize: 18,
    color: colors.onSurface,
  },
  switchBadge: {
    marginLeft: spacing.sm,
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  switchBadgeText: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
  },
  roleBadge: {
    backgroundColor: colors.surfaceContainerHighest,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  roleBadgeOwner: {
    backgroundColor: colors.primaryContainer,
  },
  roleBadgeManager: {
    backgroundColor: colors.secondaryContainer,
  },
  roleBadgeText: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
  },
  roleBadgeTextOwner: {
    color: colors.onPrimaryContainer,
  },
  roleBadgeTextManager: {
    color: colors.onSecondaryContainer,
  },
  welcomeSection: {
    marginBottom: spacing.xxl,
  },
  welcomeTitle: {
    ...typography.headlineMedium,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  welcomeSubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  actionsGrid: {
    gap: spacing.lg,
    marginBottom: spacing.xxxl,
  },
  actionCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: spacing.xl,
  },
  actionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  actionCardTag: {
    ...typography.labelSmall,
    color: colors.primary,
    fontWeight: '700',
  },
  actionCardTagInvite: {
    color: colors.secondary,
  },
  actionCardArrow: {
    ...typography.titleMedium,
    color: colors.onSurfaceVariant,
  },
  actionCardTitle: {
    ...typography.headlineMedium,
    fontSize: 18,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  actionCardDesc: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
  },
  actionCardSecondary: {
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCardSecondaryText: {
    ...typography.labelLarge,
    color: colors.primary,
  },
  logoutSection: {
    gap: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  logoutButton: {
    backgroundColor: colors.surfaceContainerLow,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  logoutButtonText: {
    ...typography.labelLarge,
    color: colors.onSurface,
  },
  logoutAllButton: {
    backgroundColor: colors.error,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  logoutAllButtonText: {
    ...typography.labelLarge,
    color: colors.onError,
  },
  errorContainer: {
    backgroundColor: colors.errorContainer,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.bodyMedium,
    color: colors.onErrorContainer,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalContent: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    ...typography.headlineMedium,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xl,
  },
  clinicOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginBottom: spacing.md,
  },
  clinicOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  clinicOptionInfo: {
    flex: 1,
  },
  clinicOptionName: {
    ...typography.titleMedium,
    color: colors.onSurface,
    marginBottom: 2,
  },
  clinicOptionNameActive: {
    color: colors.onPrimaryContainer,
  },
  clinicOptionRole: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
  },
  checkmark: {
    ...typography.titleMedium,
    color: colors.primary,
    marginLeft: spacing.md,
  },
  newClinicModalButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  newClinicModalText: {
    ...typography.labelLarge,
    color: colors.primary,
  },
  modalCloseButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  modalCloseText: {
    ...typography.labelLarge,
    color: colors.onSurfaceVariant,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },
});
