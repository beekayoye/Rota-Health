import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import axios from 'axios';
import { apiClient, API_BASE_URL } from '../../src/api/client';
import { useTeamStore } from '../../src/state/team';
import { colors, spacing, radii, typography } from '../../src/theme/tokens';

// Generate 30-minute time intervals: ["00:00", "00:30", ..., "23:30"]
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, '0');
  const m = (i % 2 === 0 ? '00' : '30');
  return `${h}:${m}`;
});

interface MemberOption {
  userId: string;
  name: string;
  role: string;
  status: string;
}

export default function NewShiftScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const clinics = useTeamStore((state) => state.clinics);
  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const clinicZone = activeClinic?.timeZone || 'Africa/Lagos';

  // Form states
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('');
  const [position, setPosition] = useState('Nurse');
  const [notes, setNotes] = useState('');

  // JS Date picker state: default to today in clinic zone
  const [selectedDay, setSelectedDay] = useState(() =>
    DateTime.now().setZone(clinicZone).startOf('day'),
  );
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');

  // Error states
  const [overlapError, setOverlapError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Fetch active team members
  const { data: membersResult, isLoading: isLoadingMembers } = useQuery({
    queryKey: ['team', activeTeamId, 'members'],
    queryFn: async () => {
      const res = await apiClient.get(`${API_BASE_URL}/v1/teams/${activeTeamId}/members`);
      return res.data as { members: MemberOption[] };
    },
    enabled: Boolean(activeTeamId),
  });

  const rawMembersList: MemberOption[] = Array.isArray(membersResult)
    ? (membersResult as MemberOption[])
    : Array.isArray((membersResult as any)?.members)
    ? ((membersResult as any).members as MemberOption[])
    : [];
  const activeMembers: MemberOption[] = rawMembersList.filter((m) => m.status === 'ACTIVE');

  // 7 days surrounding selectedDay
  const safeDay = selectedDay?.isValid ? selectedDay : DateTime.now().setZone(clinicZone).startOf('day');
  const startOfWeek = safeDay.startOf('week');
  const daysInWeek = Array.from({ length: 7 }, (_, i) => startOfWeek.plus({ days: i }));

  const createMutation = useMutation({
    mutationFn: async () => {
      setOverlapError(null);
      setGeneralError(null);

      if (!selectedAssigneeId) {
        throw new Error('Please select an assignee');
      }
      if (!position.trim()) {
        throw new Error('Please enter a position/role title');
      }

      // Calculate startsAt and endsAt in UTC
      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);

      const startsAtLux = selectedDay.set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
      let endsAtLux = selectedDay.set({ hour: endH, minute: endM, second: 0, millisecond: 0 });

      // If end time is earlier or equal to start time, it crosses midnight to next day
      if (endsAtLux <= startsAtLux) {
        endsAtLux = endsAtLux.plus({ days: 1 });
      }

      const diffHours = endsAtLux.diff(startsAtLux, 'hours').hours;
      if (diffHours > 24) {
        throw new Error('Shift length cannot exceed 24 hours');
      }

      const res = await apiClient.post(`${API_BASE_URL}/v1/teams/${activeTeamId}/shifts`, {
        assigneeId: selectedAssigneeId,
        position: position.trim(),
        notes: notes.trim() || undefined,
        startsAt: startsAtLux.toUTC().toISO(),
        endsAt: endsAtLux.toUTC().toISO(),
      });
      return res.data;
    },
    onSuccess: () => {
      // Invalidate relevant queries per PRD 14
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'shifts'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'shifts', 'upcoming'] });
      router.back();
    },
    onError: (err: any) => {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        const error = err.response.data.error;
        if (error.code === 'SHIFT_OVERLAP') {
          setOverlapError('⚠️ Shift clash: This staff member already has an overlapping shift scheduled in this clinic.');
          return;
        }
        setGeneralError(error.message || 'Failed to create shift');
      } else {
        setGeneralError(err.message || 'An error occurred');
      }
    },
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Draft Shift</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {generalError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{generalError}</Text>
            </View>
          )}

          {/* Assignee Selection */}
          <Text style={styles.sectionLabel}>Select Assignee *</Text>
          {isLoadingMembers ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
              {activeMembers.map((m) => {
                const isSelected = selectedAssigneeId === m.userId;
                return (
                  <TouchableOpacity
                    key={m.userId}
                    style={[styles.memberChip, isSelected && styles.memberChipSelected]}
                    onPress={() => {
                      setSelectedAssigneeId(m.userId);
                      setOverlapError(null);
                    }}
                  >
                    <Text style={[styles.memberChipText, isSelected && styles.memberChipTextSelected]}>
                      {m.name} ({m.role})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Inline Overlap Error per PRD 10 & Brief */}
          {overlapError && (
            <View style={styles.inlineOverlapBox}>
              <Text style={styles.inlineOverlapText}>{overlapError}</Text>
            </View>
          )}

          {/* Position Input */}
          <Text style={styles.sectionLabel}>Position / Role *</Text>
          <TextInput
            style={styles.input}
            value={position}
            onChangeText={setPosition}
            placeholder="e.g. Ward Nurse, Triage Officer, Doctor"
            placeholderTextColor={colors.outline}
          />

          {/* Day Chips (JavaScript Date Picker for Selected Week) */}
          <View style={styles.dateHeaderRow}>
            <Text style={styles.sectionLabel}>Shift Date ({clinicZone}) *</Text>
            <View style={styles.weekNavMini}>
              <TouchableOpacity
                onPress={() => setSelectedDay((prev) => prev.minus({ weeks: 1 }))}
                style={styles.miniNavBtn}
              >
                <Text style={styles.miniNavBtnText}>‹ Prev</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setSelectedDay((prev) => prev.plus({ weeks: 1 }))}
                style={styles.miniNavBtn}
              >
                <Text style={styles.miniNavBtnText}>Next ›</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.dayGrid}>
            {daysInWeek.map((day) => {
              const isSelected = day.hasSame(selectedDay, 'day');
              return (
                <TouchableOpacity
                  key={day.toISODate()}
                  style={[styles.dayChip, isSelected && styles.dayChipSelected]}
                  onPress={() => setSelectedDay(day)}
                >
                  <Text style={[styles.dayChipWeekday, isSelected && styles.dayChipTextSelected]}>
                    {day.toFormat('ccc')}
                  </Text>
                  <Text style={[styles.dayChipDate, isSelected && styles.dayChipTextSelected]}>
                    {day.toFormat('d')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Time Pickers (30-minute intervals) */}
          <Text style={styles.sectionLabel}>Start Time *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timeScroll}>
            {TIME_OPTIONS.map((time) => {
              const isSelected = startTime === time;
              return (
                <TouchableOpacity
                  key={`start-${time}`}
                  style={[styles.timeChip, isSelected && styles.timeChipSelected]}
                  onPress={() => setStartTime(time)}
                >
                  <Text style={[styles.timeChipText, isSelected && styles.timeChipTextSelected]}>
                    {time}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionLabel}>End Time *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timeScroll}>
            {TIME_OPTIONS.map((time) => {
              const isSelected = endTime === time;
              return (
                <TouchableOpacity
                  key={`end-${time}`}
                  style={[styles.timeChip, isSelected && styles.timeChipSelected]}
                  onPress={() => setEndTime(time)}
                >
                  <Text style={[styles.timeChipText, isSelected && styles.timeChipTextSelected]}>
                    {time}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Shift Summary Box */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Schedule Preview</Text>
            <Text style={styles.summaryDetails}>
              📅 {selectedDay.toFormat('EEEE, d MMMM yyyy')}
            </Text>
            <Text style={styles.summaryDetails}>
              ⏰ {startTime} – {endTime}
            </Text>
          </View>

          {/* Notes Input */}
          <Text style={styles.sectionLabel}>Notes (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Special instructions or handover notes..."
            placeholderTextColor={colors.outline}
            multiline
            numberOfLines={3}
            maxLength={500}
          />

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.submitButton, createMutation.isPending && styles.submitButtonDisabled]}
            onPress={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            activeOpacity={0.8}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.submitButtonText}>Create Draft Shift</Text>
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
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.bodyMedium,
    color: colors.onErrorContainer,
  },
  sectionLabel: {
    ...typography.titleMedium,
    color: colors.onSurface,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  chipsScroll: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  memberChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLow,
    marginRight: spacing.sm,
  },
  memberChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  memberChipText: {
    ...typography.bodyMedium,
    fontSize: 13,
    color: colors.onSurface,
  },
  memberChipTextSelected: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  inlineOverlapBox: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffeeba',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  inlineOverlapText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.onSurface,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  dateHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekNavMini: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  miniNavBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  miniNavBtnText: {
    ...typography.labelSmall,
    color: colors.primary,
    fontWeight: '700',
  },
  dayGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  dayChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginHorizontal: 2,
  },
  dayChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayChipWeekday: {
    fontSize: 11,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  dayChipDate: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
    marginTop: 2,
  },
  dayChipTextSelected: {
    color: colors.onPrimary,
  },
  timeScroll: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  timeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginRight: spacing.sm,
  },
  timeChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  timeChipText: {
    ...typography.labelMedium,
    color: colors.onSurface,
    fontWeight: '600',
  },
  timeChipTextSelected: {
    color: colors.onPrimary,
  },
  summaryCard: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginVertical: spacing.md,
  },
  summaryTitle: {
    ...typography.labelLarge,
    color: colors.onPrimaryContainer,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  summaryDetails: {
    ...typography.bodyMedium,
    color: colors.onPrimaryContainer,
    fontSize: 13,
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
  submitButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
});
