import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import axios from 'axios';
import { apiClient, API_BASE_URL } from '../../src/api/client';
import { useTeamStore } from '../../src/state/team';
import { colors, spacing, radii, typography } from '../../src/theme/tokens';
import { ShiftItem } from '../calendar';

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

interface MemberOption {
  userId: string;
  name: string;
  role: string;
  status: string;
}

export default function EditShiftScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const clinics = useTeamStore((state) => state.clinics);
  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const clinicZone = activeClinic?.timeZone || 'Africa/Lagos';

  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('');
  const [position, setPosition] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedDay, setSelectedDay] = useState<DateTime>(() =>
    DateTime.now().setZone(clinicZone).startOf('day'),
  );
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [shiftVersion, setShiftVersion] = useState<number>(1);
  const [isInitialized, setIsInitialized] = useState(false);

  const [overlapError, setOverlapError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Fetch shift details
  const {
    data: shift,
    isLoading: isLoadingShift,
    isError: isShiftError,
    refetch: refetchShift,
  } = useQuery<ShiftItem>({
    queryKey: ['team', activeTeamId, 'shift', id],
    queryFn: async () => {
      const res = await apiClient.get(`${API_BASE_URL}/v1/teams/${activeTeamId}/shifts/${id}`);
      return res.data.shift;
    },
    enabled: Boolean(activeTeamId && id),
  });

  // Fetch active members
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

  // Populate initial state from fetched shift
  useEffect(() => {
    if (shift && !isInitialized) {
      setSelectedAssigneeId(shift.assigneeId);
      setPosition(shift.position);
      setNotes(shift.notes || '');
      setShiftVersion(shift.version);

      const startLux = DateTime.fromISO(shift.startsAt, { zone: clinicZone });
      const endLux = DateTime.fromISO(shift.endsAt, { zone: clinicZone });

      setSelectedDay(startLux.startOf('day'));
      setStartTime(startLux.toFormat('HH:mm'));
      setEndTime(endLux.toFormat('HH:mm'));
      setIsInitialized(true);
    }
  }, [shift, clinicZone, isInitialized]);

  const safeDay = selectedDay?.isValid ? selectedDay : DateTime.now().setZone(clinicZone).startOf('day');
  const startOfWeek = safeDay.startOf('week');
  const daysInWeek = Array.from({ length: 7 }, (_, i) => startOfWeek.plus({ days: i }));

  const updateMutation = useMutation({
    mutationFn: async () => {
      setOverlapError(null);
      setGeneralError(null);

      if (!selectedAssigneeId) {
        throw new Error('Please select an assignee');
      }
      if (!position.trim()) {
        throw new Error('Please enter a position/role title');
      }

      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);

      const startsAtLux = selectedDay.set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
      let endsAtLux = selectedDay.set({ hour: endH, minute: endM, second: 0, millisecond: 0 });

      if (endsAtLux <= startsAtLux) {
        endsAtLux = endsAtLux.plus({ days: 1 });
      }

      const diffHours = endsAtLux.diff(startsAtLux, 'hours').hours;
      if (diffHours > 24) {
        throw new Error('Shift length cannot exceed 24 hours');
      }

      const res = await apiClient.patch(`${API_BASE_URL}/v1/teams/${activeTeamId}/shifts/${id}`, {
        version: shiftVersion,
        assigneeId: selectedAssigneeId,
        position: position.trim(),
        notes: notes.trim() || undefined,
        startsAt: startsAtLux.toUTC().toISO(),
        endsAt: endsAtLux.toUTC().toISO(),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'shifts'] });
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'shift', id] });
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
        if (error.code === 'VERSION_CONFLICT') {
          Alert.alert(
            'Concurrent Edit Conflict',
            'This shift was modified by another manager. Would you like to reload the latest changes?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Reload',
                onPress: async () => {
                  setIsInitialized(false);
                  await refetchShift();
                },
              },
            ],
          );
          return;
        }
        setGeneralError(error.message || 'Failed to update shift');
      } else {
        setGeneralError(err.message || 'An error occurred');
      }
    },
  });

  if (isLoadingShift) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading shift...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isShiftError || !shift) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Shift</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Unable to load shift details.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Shift</Text>
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.assigneeList}>
              {activeMembers.map((member) => {
                const isSelected = selectedAssigneeId === member.userId;
                return (
                  <TouchableOpacity
                    key={member.userId}
                    style={[styles.memberChip, isSelected && styles.memberChipSelected]}
                    onPress={() => setSelectedAssigneeId(member.userId)}
                  >
                    <Text style={[styles.memberChipText, isSelected && styles.memberChipTextSelected]}>
                      {member.name}
                    </Text>
                    <Text style={[styles.memberChipRole, isSelected && styles.memberChipRoleSelected]}>
                      {member.role}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Shift Date */}
          <Text style={styles.sectionLabel}>Shift Date ({clinicZone})</Text>
          <View style={styles.dayPickerRow}>
            {daysInWeek.map((day) => {
              const isSelected = safeDay.hasSame(day, 'day');
              return (
                <TouchableOpacity
                  key={day.toISO()}
                  style={[styles.dayButton, isSelected && styles.dayButtonSelected]}
                  onPress={() => setSelectedDay(day)}
                >
                  <Text style={[styles.dayButtonWeekday, isSelected && styles.dayButtonTextSelected]}>
                    {day.toFormat('ccc')}
                  </Text>
                  <Text style={[styles.dayButtonNum, isSelected && styles.dayButtonTextSelected]}>
                    {day.toFormat('d')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Time Picker */}
          <View style={styles.timeRow}>
            <View style={styles.timeCol}>
              <Text style={styles.sectionLabel}>Starts At *</Text>
              <ScrollView style={styles.timePickerBox} nestedScrollEnabled>
                {TIME_OPTIONS.map((t) => (
                  <TouchableOpacity
                    key={`start-${t}`}
                    style={[styles.timeOption, startTime === t && styles.timeOptionSelected]}
                    onPress={() => setStartTime(t)}
                  >
                    <Text style={[styles.timeOptionText, startTime === t && styles.timeOptionTextSelected]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.timeCol}>
              <Text style={styles.sectionLabel}>Ends At *</Text>
              <ScrollView style={styles.timePickerBox} nestedScrollEnabled>
                {TIME_OPTIONS.map((t) => (
                  <TouchableOpacity
                    key={`end-${t}`}
                    style={[styles.timeOption, endTime === t && styles.timeOptionSelected]}
                    onPress={() => setEndTime(t)}
                  >
                    <Text style={[styles.timeOptionText, endTime === t && styles.timeOptionTextSelected]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Overlap Error Banner */}
          {overlapError && (
            <View style={styles.overlapWarningBanner}>
              <Text style={styles.overlapWarningText}>{overlapError}</Text>
            </View>
          )}

          {/* Role / Position Input */}
          <Text style={styles.sectionLabel}>Position / Role Title *</Text>
          <TextInput
            style={styles.input}
            value={position}
            onChangeText={setPosition}
            placeholder="e.g. Registered Nurse, Senior Triage"
            placeholderTextColor={colors.onSurfaceVariant}
          />

          {/* Handover Notes */}
          <Text style={styles.sectionLabel}>Handover Notes (Optional)</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Enter clinical handover notes, room assignment, or special instructions..."
            placeholderTextColor={colors.onSurfaceVariant}
            multiline
            numberOfLines={4}
          />

          {/* Save Button */}
          <TouchableOpacity
            style={styles.submitButton}
            onPress={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            activeOpacity={0.8}
          >
            {updateMutation.isPending ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.submitButtonText}>💾 Save Changes</Text>
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.bodyMedium.fontSize,
    color: colors.onSurfaceVariant,
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
    fontSize: typography.bodyMedium.fontSize,
    color: colors.primary,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: typography.titleMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  scrollContent: {
    padding: spacing.xxl,
    paddingBottom: spacing.xxxl * 2,
  },
  sectionLabel: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  assigneeList: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  memberChip: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  memberChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  memberChipText: {
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
  },
  memberChipTextSelected: {
    color: colors.onPrimary,
  },
  memberChipRole: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  memberChipRoleSelected: {
    color: colors.primaryContainer,
  },
  dayPickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
  dayButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 2,
  },
  dayButtonSelected: {
    backgroundColor: colors.primary,
  },
  dayButtonWeekday: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
  },
  dayButtonNum: {
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    marginTop: 2,
  },
  dayButtonTextSelected: {
    color: colors.onPrimary,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  timeCol: {
    flex: 1,
  },
  timePickerBox: {
    height: 120,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  timeOption: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainer,
  },
  timeOptionSelected: {
    backgroundColor: colors.primaryContainer,
  },
  timeOptionText: {
    fontSize: typography.bodyMedium.fontSize,
    color: colors.onSurface,
  },
  timeOptionTextSelected: {
    color: colors.onPrimaryContainer,
    fontWeight: '700',
  },
  overlapWarningBanner: {
    backgroundColor: '#fef2f2',
    borderColor: '#ef4444',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  overlapWarningText: {
    color: '#991b1b',
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.bodyMedium.fontSize,
    color: colors.onSurface,
  },
  notesInput: {
    height: 90,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  submitButtonText: {
    color: colors.onPrimary,
    fontSize: typography.bodyLarge.fontSize,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: colors.errorContainer,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.onErrorContainer,
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '600',
  },
});
