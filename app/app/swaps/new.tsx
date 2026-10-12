import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { apiClient, API_BASE_URL } from '../../src/api/client';
import { useAuthStore } from '../../src/state/auth';
import { useTeamStore } from '../../src/state/team';
import { colors, spacing, radii, typography } from '../../src/theme/tokens';
import { ShiftItem } from '../calendar';

export default function NewSwapScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { shiftId } = useLocalSearchParams<{ shiftId: string }>();
  const currentUser = useAuthStore((state) => state.user);
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const clinics = useTeamStore((state) => state.clinics);
  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const clinicZone = activeClinic?.timeZone || 'Africa/Lagos';

  const [selectedColleagueShiftId, setSelectedColleagueShiftId] = useState<string | null>(null);

  // Optimistic UI state per PRD 14 & Brief
  const [isOptimisticRequested, setIsOptimisticRequested] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Fetch requester's own shift
  const { data: myShift, isLoading: isLoadingMyShift } = useQuery<ShiftItem>({
    queryKey: ['team', activeTeamId, 'shift', shiftId],
    queryFn: async () => {
      const res = await apiClient.get(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/shifts/${shiftId}`,
      );
      return res.data.shift;
    },
    enabled: Boolean(activeTeamId && shiftId),
  });

  // 2. Fetch colleague shifts for next 14 days (week 1 and week 2)
  const now = DateTime.now().setZone(clinicZone);
  const week1 = now.startOf('week').toISODate()!;
  const week2 = now.startOf('week').plus({ weeks: 1 }).toISODate()!;

  const { data: colleagueShifts, isLoading: isLoadingColleagues } = useQuery<ShiftItem[]>({
    queryKey: ['team', activeTeamId, 'colleague-shifts-14d'],
    queryFn: async () => {
      const [res1, res2] = await Promise.all([
        apiClient.get(`${API_BASE_URL}/v1/teams/${activeTeamId}/shifts?weekStart=${week1}`),
        apiClient.get(`${API_BASE_URL}/v1/teams/${activeTeamId}/shifts?weekStart=${week2}`),
      ]);

      const all = [...(res1.data.shifts || []), ...(res2.data.shifts || [])];
      const nowJs = new Date();

      // Filter: published, future, assigned to colleague (not current user)
      return all.filter(
        (s: ShiftItem) =>
          s.status === 'PUBLISHED' &&
          s.assigneeId !== currentUser?.id &&
          new Date(s.startsAt) > nowJs,
      );
    },
    enabled: Boolean(activeTeamId && currentUser?.id),
  });

  // Mutation with optimistic update and rollback (PRD 14)
  const swapMutation = useMutation({
    mutationFn: async ({ colleagueShiftId, idempotencyKey }: { colleagueShiftId: string; idempotencyKey: string }) => {
      const res = await apiClient.post(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/swaps`,
        {
          requesterShiftId: shiftId,
          targetShiftId: colleagueShiftId,
        },
        {
          headers: { 'Idempotency-Key': idempotencyKey },
        },
      );
      return res.data;
    },
    onMutate: () => {
      // 1. Instantly show "Swap requested" and disable button
      setIsOptimisticRequested(true);
      setErrorMessage(null);
    },
    onSuccess: () => {
      // Invalidate affected queries
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'swaps'] });
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'shifts'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'shifts', 'upcoming'] });

      Alert.alert('Success', 'Your swap request was submitted to your colleague.', [
        { text: 'View Swaps', onPress: () => router.replace('/swaps' as any) },
      ]);
    },
    onError: (err: any) => {
      // Rollback optimistic state
      setIsOptimisticRequested(false);
      const msg =
        err.response?.data?.error?.message ||
        err.message ||
        'Unable to request swap. Please try again.';
      setErrorMessage(msg);
      Alert.alert('Swap Request Failed', msg);
    },
  });

  const handleSubmit = () => {
    if (!selectedColleagueShiftId) {
      Alert.alert('Select a Shift', 'Please select a colleague shift from the list to swap with.');
      return;
    }

    // Generate unique Idempotency-Key per tap (UUID v4)
    const idempotencyKey = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

    swapMutation.mutate({ colleagueShiftId: selectedColleagueShiftId, idempotencyKey });
  };

  const isPending = isOptimisticRequested || swapMutation.isPending;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} disabled={isPending}>
            <Text style={styles.backButtonText}>← Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Request Swap</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {errorMessage && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
            </View>
          )}

          {/* Section 1: My Shift being offered */}
          <Text style={styles.sectionTitle}>Your Shift to Swap</Text>
          {isLoadingMyShift || !myShift ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <View style={styles.myShiftCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.myShiftPosition}>{myShift.position}</Text>
                <Text style={styles.myShiftBadge}>YOUR SHIFT</Text>
              </View>
              <Text style={styles.cardDateTime}>
                📅 {DateTime.fromISO(myShift.startsAt, { zone: clinicZone }).toFormat('EEEE, d LLL yyyy')}
              </Text>
              <Text style={styles.cardTime}>
                ⏰ {DateTime.fromISO(myShift.startsAt, { zone: clinicZone }).toFormat('HH:mm')} –{' '}
                {DateTime.fromISO(myShift.endsAt, { zone: clinicZone }).toFormat('HH:mm')}
              </Text>
              {myShift.notes ? <Text style={styles.cardNotes}>📝 {myShift.notes}</Text> : null}
            </View>
          )}

          {/* Section 2: Colleague's Shift to pick */}
          <Text style={styles.sectionTitle}>Pick a Colleague's Shift (Next 14 Days)</Text>
          <Text style={styles.sectionSubtitle}>
            Select the shift you would like to take over in exchange for yours:
          </Text>

          {isLoadingColleagues ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>Loading eligible colleague shifts...</Text>
            </View>
          ) : !colleagueShifts || colleagueShifts.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>⏳</Text>
              <Text style={styles.emptyTitle}>No colleague shifts available</Text>
              <Text style={styles.emptyText}>
                No upcoming published shifts for colleagues found in the next 14 days.
              </Text>
            </View>
          ) : (
            colleagueShifts.map((shift) => {
              const isSelected = selectedColleagueShiftId === shift.id;
              const startLux = DateTime.fromISO(shift.startsAt, { zone: clinicZone });
              const endLux = DateTime.fromISO(shift.endsAt, { zone: clinicZone });

              return (
                <TouchableOpacity
                  key={shift.id}
                  style={[styles.colleagueCard, isSelected && styles.colleagueCardSelected]}
                  onPress={() => setSelectedColleagueShiftId(shift.id)}
                  disabled={isPending}
                  activeOpacity={0.8}
                >
                  <View style={styles.colleagueCardTop}>
                    <Text style={styles.colleagueRadio}>{isSelected ? '🔘' : '⚪'}</Text>
                    <View style={styles.colleagueHeaderInfo}>
                      <Text style={styles.colleaguePosition}>{shift.position}</Text>
                      <Text style={styles.colleagueName}>👤 {shift.assignee?.name} ({shift.assignee?.role})</Text>
                    </View>
                  </View>

                  <View style={styles.colleagueTimeRow}>
                    <Text style={styles.colleagueDate}>{startLux.toFormat('ccc, d LLL')}</Text>
                    <Text style={styles.colleagueTime}>
                      {startLux.toFormat('HH:mm')} – {endLux.toFormat('HH:mm')}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          {/* Action Submit Button with PRD 14 Optimistic Feedback */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!selectedColleagueShiftId || isPending) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedColleagueShiftId || isPending}
            activeOpacity={0.8}
          >
            {isPending ? (
              <View style={styles.buttonInner}>
                <ActivityIndicator color={colors.onPrimary} size="small" />
                <Text style={styles.submitButtonText}>Swap requested</Text>
              </View>
            ) : (
              <Text style={styles.submitButtonText}>Send Swap Request</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
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
  backButton: {
    paddingVertical: spacing.xs,
  },
  backButtonText: {
    ...typography.labelLarge,
    color: colors.primary,
  },
  headerTitle: {
    ...typography.headlineMedium,
    fontSize: 18,
    color: colors.onSurface,
  },
  scrollContent: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
  },
  errorBox: {
    backgroundColor: colors.errorContainer,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  errorText: {
    ...typography.bodyMedium,
    color: colors.onErrorContainer,
  },
  sectionTitle: {
    ...typography.titleMedium,
    color: colors.onSurface,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  myShiftCard: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  myShiftPosition: {
    ...typography.titleMedium,
    color: colors.onPrimaryContainer,
    fontWeight: '800',
    fontSize: 16,
  },
  myShiftBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.onPrimary,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  cardDateTime: {
    ...typography.bodyMedium,
    color: colors.onPrimaryContainer,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardTime: {
    ...typography.bodyMedium,
    color: colors.onPrimaryContainer,
  },
  cardNotes: {
    ...typography.bodySmall,
    color: colors.onPrimaryContainer,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  centerContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  loadingText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    marginTop: spacing.sm,
  },
  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.lg,
    marginVertical: spacing.sm,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    ...typography.titleMedium,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 4,
  },
  emptyText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    fontSize: 12,
  },
  colleagueCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  colleagueCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  colleagueCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  colleagueRadio: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  colleagueHeaderInfo: {
    flex: 1,
  },
  colleaguePosition: {
    ...typography.titleMedium,
    color: colors.primary,
    fontWeight: '700',
  },
  colleagueName: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurface,
  },
  colleagueTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 28,
  },
  colleagueDate: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  colleagueTime: {
    ...typography.bodyMedium,
    color: colors.onSurface,
    fontWeight: '700',
  },
  submitButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  submitButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
});
