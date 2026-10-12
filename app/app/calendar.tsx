import React, { useState } from 'react';
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
import { useTeamStore } from '../src/state/team';
import { colors, spacing, radii, typography } from '../src/theme/tokens';
import { BottomNav } from '../src/components/BottomNav';

export interface ShiftItem {
  id: string;
  teamId: string;
  assigneeId: string;
  assignee: {
    id: string;
    userId: string;
    name: string;
    email: string;
    role: string;
  };
  position: string;
  notes?: string | null;
  startsAt: string;
  endsAt: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt?: string | null;
  version: number;
}

export default function CalendarScreen() {
  const router = useRouter();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeRole = useTeamStore((state) => state.activeRole);
  const clinics = useTeamStore((state) => state.clinics);

  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const clinicZone = activeClinic?.timeZone || 'Africa/Lagos';

  const isManagerOrOwner = activeRole === 'OWNER' || activeRole === 'MANAGER';

  // Current ISO week start (Monday) in clinic zone
  const [selectedDate, setSelectedDate] = useState(() =>
    DateTime.now().setZone(clinicZone).startOf('week'),
  );

  const weekStartStr = selectedDate.toISODate() || DateTime.now().toISODate()!;

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['team', activeTeamId, 'shifts', weekStartStr],
    queryFn: async () => {
      if (!activeTeamId) return { shifts: [] };
      const res = await apiClient.get(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/shifts?weekStart=${weekStartStr}`,
      );
      return res.data as { shifts: ShiftItem[]; weekStart: string; weekEnd: string; timeZone: string };
    },
    enabled: Boolean(activeTeamId),
  });

  const shifts: ShiftItem[] = data?.shifts || [];
  const draftCount = shifts.filter((s) => s.status === 'DRAFT').length;

  const handlePrevWeek = () => {
    setSelectedDate((prev) => prev.minus({ weeks: 1 }));
  };

  const handleNextWeek = () => {
    setSelectedDate((prev) => prev.plus({ weeks: 1 }));
  };

  const handleCurrentWeek = () => {
    setSelectedDate(DateTime.now().setZone(clinicZone).startOf('week'));
  };

  // Generate the 7 days of this ISO week
  const daysOfWeek = Array.from({ length: 7 }, (_, i) => selectedDate.plus({ days: i }));

  // Helper to determine if a shift falls on a given day in the clinic's timezone
  // A shift crossing midnight appears on both days per PRD 6.3
  const getShiftsForDay = (day: DateTime) => {
    const dayStart = day.startOf('day');
    const dayEnd = day.endOf('day');

    return shifts
      .map((shift) => {
        const startLux = DateTime.fromISO(shift.startsAt, { zone: clinicZone });
        const endLux = DateTime.fromISO(shift.endsAt, { zone: clinicZone });

        const isStartingToday = startLux >= dayStart && startLux <= dayEnd;
        const isContinuingToday =
          startLux < dayStart && endLux > dayStart;

        if (isStartingToday || isContinuingToday) {
          return {
            ...shift,
            isContinuing: isContinuingToday,
            displayStart: startLux.toFormat('HH:mm'),
            displayEnd: endLux.toFormat('HH:mm'),
          };
        }
        return null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>{activeClinic?.name || 'Rota Calendar'}</Text>
            <Text style={styles.headerSubtitle}>
              {clinicZone} • {activeRole || 'STAFF'}
            </Text>
          </View>

          {isManagerOrOwner && (
            <TouchableOpacity
              style={styles.newShiftButton}
              onPress={() => router.push('/shifts/new' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.newShiftButtonText}>+ New Shift</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Manager/Owner Draft Publish Banner */}
        {isManagerOrOwner && draftCount > 0 && (
          <View style={styles.publishBanner}>
            <View style={styles.publishBannerTextContainer}>
              <Text style={styles.publishBannerTitle}>
                {draftCount} Draft {draftCount === 1 ? 'Shift' : 'Shifts'} Unpublished
              </Text>
              <Text style={styles.publishBannerSubtitle}>
                Staff cannot view drafts until published.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.publishBannerButton}
              onPress={() => router.push('/shifts/publish' as any)}
            >
              <Text style={styles.publishBannerButtonText}>Review & Publish</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Week Navigation Header */}
        <View style={styles.weekNavBar}>
          <TouchableOpacity style={styles.navButton} onPress={handlePrevWeek}>
            <Text style={styles.navButtonText}>← Prev</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.weekLabelContainer} onPress={handleCurrentWeek}>
            <Text style={styles.weekLabelText}>
              {selectedDate.toFormat('d LLL')} – {selectedDate.plus({ days: 6 }).toFormat('d LLL yyyy')}
            </Text>
            <Text style={styles.todayHintText}>Tap for current week</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.navButton} onPress={handleNextWeek}>
            <Text style={styles.navButtonText}>Next →</Text>
          </TouchableOpacity>
        </View>

        {/* Schedule List Content */}
        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading shift schedule...</Text>
          </View>
        ) : isError ? (
          <View style={styles.centerContainer}>
            <Text style={styles.errorText}>Unable to load shifts.</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.scheduleScroll}
            contentContainerStyle={styles.scheduleContent}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
            }
          >
            {daysOfWeek.map((day) => {
              const dayShifts = getShiftsForDay(day);
              const isToday =
                day.hasSame(DateTime.now().setZone(clinicZone), 'day');

              return (
                <View key={day.toISODate()} style={styles.daySection}>
                  <View style={[styles.dayHeader, isToday && styles.dayHeaderToday]}>
                    <Text style={[styles.dayName, isToday && styles.dayNameToday]}>
                      {day.toFormat('EEEE')}
                    </Text>
                    <Text style={[styles.dayDate, isToday && styles.dayDateToday]}>
                      {day.toFormat('d LLL')}
                    </Text>
                  </View>

                  {dayShifts.length === 0 ? (
                    <View style={styles.emptyDayContainer}>
                      <Text style={styles.emptyDayText}>No shifts scheduled</Text>
                    </View>
                  ) : (
                    dayShifts.map((shift) => {
                      const isDraft = shift.status === 'DRAFT';
                      return (
                        <TouchableOpacity
                          key={`${shift.id}-${day.toISODate()}`}
                          style={[
                            styles.shiftCard,
                            isDraft ? styles.shiftCardDraft : styles.shiftCardPublished,
                          ]}
                          onPress={() => router.push(`/shifts/${shift.id}` as any)}
                          activeOpacity={0.8}
                        >
                          <View style={styles.shiftCardTop}>
                            <View style={styles.shiftTimeContainer}>
                              <Text style={styles.shiftTimeText}>
                                {shift.displayStart} – {shift.displayEnd}
                              </Text>
                              {shift.isContinuing && (
                                <Text style={styles.continuingBadge}>(continues)</Text>
                              )}
                            </View>

                            <View
                              style={[
                                styles.statusBadge,
                                isDraft ? styles.statusBadgeDraft : styles.statusBadgePublished,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusBadgeText,
                                  isDraft
                                    ? styles.statusBadgeTextDraft
                                    : styles.statusBadgeTextPublished,
                                ]}
                              >
                                {isDraft ? 'DRAFT' : 'PUBLISHED'}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.shiftCardMiddle}>
                            <Text style={styles.shiftPosition}>{shift.position}</Text>
                            <Text style={styles.shiftAssignee}>
                              👤 {shift.assignee?.name || 'Unassigned'} ({shift.assignee?.role})
                            </Text>
                          </View>

                          {shift.notes ? (
                            <Text style={styles.shiftNotes} numberOfLines={2}>
                              📝 {shift.notes}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Global Bottom Navigation */}
        <BottomNav currentTab="calendar" />
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  headerTitle: {
    ...typography.headlineMedium,
    fontSize: 18,
    color: colors.onSurface,
  },
  headerSubtitle: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  newShiftButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  newShiftButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '600',
  },
  publishBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
  },
  publishBannerTextContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  publishBannerTitle: {
    ...typography.titleMedium,
    fontSize: 13,
    color: colors.onPrimaryContainer,
    fontWeight: '700',
  },
  publishBannerSubtitle: {
    ...typography.bodyMedium,
    fontSize: 11,
    color: colors.onPrimaryContainer,
  },
  publishBannerButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.sm,
  },
  publishBannerButtonText: {
    ...typography.labelSmall,
    color: colors.onPrimary,
    fontWeight: '600',
  },
  weekNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  navButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  navButtonText: {
    ...typography.labelMedium,
    color: colors.primary,
    fontWeight: '700',
  },
  weekLabelContainer: {
    alignItems: 'center',
  },
  weekLabelText: {
    ...typography.titleMedium,
    color: colors.onSurface,
    fontWeight: '700',
  },
  todayHintText: {
    fontSize: 10,
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
  scheduleScroll: {
    flex: 1,
  },
  scheduleContent: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  daySection: {
    marginBottom: spacing.lg,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
    marginBottom: spacing.sm,
  },
  dayHeaderToday: {
    borderBottomColor: colors.primary,
  },
  dayName: {
    ...typography.titleMedium,
    color: colors.onSurface,
    fontWeight: '700',
  },
  dayNameToday: {
    color: colors.primary,
  },
  dayDate: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  dayDateToday: {
    color: colors.primary,
    fontWeight: '700',
  },
  emptyDayContainer: {
    paddingVertical: spacing.sm,
  },
  emptyDayText: {
    ...typography.bodyMedium,
    fontStyle: 'italic',
    color: colors.outline,
    fontSize: 12,
  },
  shiftCard: {
    padding: spacing.md,
    borderRadius: radii.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
  },
  shiftCardPublished: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  shiftCardDraft: {
    borderWidth: 1.5,
    borderColor: colors.outline,
    borderStyle: 'dashed',
    backgroundColor: colors.surfaceContainerLow,
  },
  shiftCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  shiftTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  shiftTimeText: {
    ...typography.titleMedium,
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
  },
  continuingBadge: {
    ...typography.labelSmall,
    fontSize: 10,
    color: colors.secondary,
    fontStyle: 'italic',
  },
  statusBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  statusBadgeDraft: {
    backgroundColor: colors.surfaceContainerHighest,
  },
  statusBadgePublished: {
    backgroundColor: colors.primaryContainer,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusBadgeTextDraft: {
    color: colors.onSurfaceVariant,
  },
  statusBadgeTextPublished: {
    color: colors.onPrimaryContainer,
  },
  shiftCardMiddle: {
    marginBottom: spacing.xs,
  },
  shiftPosition: {
    ...typography.bodyLarge,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 2,
  },
  shiftAssignee: {
    ...typography.bodyMedium,
    color: colors.onSurface,
    fontSize: 13,
  },
  shiftNotes: {
    ...typography.bodyMedium,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
});
