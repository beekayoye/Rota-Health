import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { apiClient, API_BASE_URL } from '../src/api/client';
import { useAuthStore } from '../src/state/auth';
import { colors, spacing, radii, typography } from '../src/theme/tokens';
import { BottomNav } from '../src/components/BottomNav';

export interface MyUpcomingShift {
  id: string;
  teamId: string;
  clinicName: string;
  team: {
    id: string;
    name: string;
    timeZone: string;
  };
  assigneeId: string;
  position: string;
  notes?: string | null;
  startsAt: string;
  endsAt: string;
  status: 'PUBLISHED';
  publishedAt?: string | null;
  version: number;
}

export default function MyShiftsScreen() {
  const router = useRouter();
  const currentUser = useAuthStore((state) => state.user);

  const {
    data: shifts,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<MyUpcomingShift[]>({
    queryKey: ['me', 'shifts', 'upcoming', 14],
    queryFn: async () => {
      const res = await apiClient.get(`${API_BASE_URL}/v1/me/shifts/upcoming?days=14`);
      return res.data.shifts;
    },
  });

  // Client-side clash detection across all clinics per PRD 6.3
  const findClash = (currentShift: MyUpcomingShift, allShifts: MyUpcomingShift[]) => {
    const curStart = new Date(currentShift.startsAt).getTime();
    const curEnd = new Date(currentShift.endsAt).getTime();

    for (const other of allShifts) {
      if (other.id === currentShift.id) continue;
      const othStart = new Date(other.startsAt).getTime();
      const othEnd = new Date(other.endsAt).getTime();

      // Check overlap: startsAt < othEnd && endsAt > othStart
      if (curStart < othEnd && curEnd > othStart) {
        return other;
      }
    }
    return null;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Shifts</Text>
          <Text style={styles.headerSubtitle}>
            Next 14 Days across all your clinics • {currentUser?.name}
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading your upcoming shifts...</Text>
          </View>
        ) : isError ? (
          <View style={styles.centerContainer}>
            <Text style={styles.errorText}>Unable to load shifts.</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !shifts || shifts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🏖️</Text>
            <Text style={styles.emptyTitle}>No shifts in the next 14 days</Text>
            <Text style={styles.emptySubtitle}>
              You do not have any published shifts scheduled over the next two weeks.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
            }
          >
            {shifts.map((shift) => {
              const zone = shift.team?.timeZone || 'Africa/Lagos';
              const startLux = DateTime.fromISO(shift.startsAt, { zone });
              const endLux = DateTime.fromISO(shift.endsAt, { zone });
              const clashingShift = findClash(shift, shifts);

              return (
                <View
                  key={shift.id}
                  style={[styles.shiftCard, Boolean(clashingShift) && styles.shiftCardClash]}
                >
                  {/* Clinic Name Header */}
                  <View style={styles.clinicRow}>
                    <Text style={styles.clinicBadge}>🏥 {shift.clinicName}</Text>
                    <Text style={styles.publishedBadge}>PUBLISHED</Text>
                  </View>

                  {/* Clash Warning per PRD 6.3 */}
                  {clashingShift && (
                    <View style={styles.clashBanner}>
                      <Text style={styles.clashBannerText}>
                        ⚠️ Clashes with your shift at {clashingShift.clinicName}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.shiftPosition}>{shift.position}</Text>
                  <Text style={styles.shiftDate}>
                    📅 {startLux.toFormat('EEEE, d MMMM yyyy')}
                  </Text>
                  <Text style={styles.shiftTime}>
                    ⏰ {startLux.toFormat('HH:mm')} – {endLux.toFormat('HH:mm')} ({zone})
                  </Text>

                  {shift.notes ? (
                    <Text style={styles.shiftNotes}>📝 {shift.notes}</Text>
                  ) : null}

                  {/* Swap Request Action */}
                  <TouchableOpacity
                    style={styles.requestSwapButton}
                    onPress={() => router.push(`/swaps/new?shiftId=${shift.id}` as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.requestSwapButtonText}>🔄 Request Swap</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Global Bottom Navigation */}
        <BottomNav currentTab="my-shifts" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
  },
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  headerTitle: {
    ...typography.headlineMedium,
    fontSize: 20,
    fontWeight: '800',
    color: colors.onSurface,
  },
  headerSubtitle: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  loadingText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.bodyMedium,
    color: colors.error,
    marginBottom: spacing.md,
  },
  retryButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
  },
  retryButtonText: {
    ...typography.labelMedium,
    color: colors.onPrimary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.headlineMedium,
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptySubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  shiftCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 1,
  },
  shiftCardClash: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  clinicRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  clinicBadge: {
    ...typography.titleMedium,
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  publishedBadge: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.onPrimaryContainer,
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  clashBanner: {
    backgroundColor: colors.errorContainer,
    padding: spacing.xs,
    borderRadius: radii.sm,
    marginBottom: spacing.xs,
  },
  clashBannerText: {
    ...typography.labelSmall,
    fontSize: 11,
    color: colors.onErrorContainer,
    fontWeight: '700',
  },
  shiftPosition: {
    ...typography.headlineMedium,
    fontSize: 18,
    color: colors.onSurface,
    fontWeight: '800',
    marginVertical: 2,
  },
  shiftDate: {
    ...typography.bodyMedium,
    fontWeight: '600',
    color: colors.onSurface,
    marginBottom: 2,
  },
  shiftTime: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
  },
  shiftNotes: {
    ...typography.bodySmall,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  requestSwapButton: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.md,
  },
  requestSwapButtonText: {
    ...typography.labelMedium,
    color: colors.primary,
    fontWeight: '700',
  },
});
