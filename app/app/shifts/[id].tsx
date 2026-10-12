import React from 'react';
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
import axios from 'axios';
import { apiClient, API_BASE_URL } from '../../src/api/client';
import { useAuthStore } from '../../src/state/auth';
import { useTeamStore } from '../../src/state/team';
import { colors, spacing, radii, typography } from '../../src/theme/tokens';
import { ShiftItem } from '../calendar';

export default function ShiftDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentUser = useAuthStore((state) => state.user);
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeRole = useTeamStore((state) => state.activeRole);
  const clinics = useTeamStore((state) => state.clinics);
  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const clinicZone = activeClinic?.timeZone || 'Africa/Lagos';

  const isManagerOrOwner = activeRole === 'OWNER' || activeRole === 'MANAGER';

  const {
    data: shift,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ShiftItem>({
    queryKey: ['team', activeTeamId, 'shift', id],
    queryFn: async () => {
      const res = await apiClient.get(`${API_BASE_URL}/v1/teams/${activeTeamId}/shifts/${id}`);
      return res.data.shift;
    },
    enabled: Boolean(activeTeamId && id),
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiClient.delete(`${API_BASE_URL}/v1/teams/${activeTeamId}/shifts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'shifts'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'shifts', 'upcoming'] });
      router.back();
    },
    onError: (err: any) => {
      Alert.alert('Error', err.response?.data?.error?.message || 'Failed to delete shift');
    },
  });

  const handleDelete = () => {
    Alert.alert(
      'Delete Shift',
      'Are you sure you want to remove this shift? If published, open swaps on this shift will be expired.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
      ],
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading shift details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // 404 handler per PRD 8 & Brief: "A 404 shows 'This shift was removed'"
  if (isError) {
    const is404 = axios.isAxiosError(error) && error.response?.status === 404;
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Shift Details</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.notFoundIcon}>🗑️</Text>
          <Text style={styles.notFoundTitle}>
            {is404 ? 'This shift was removed' : 'Unable to load shift'}
          </Text>
          <Text style={styles.notFoundSubtitle}>
            {is404
              ? 'The shift has either been deleted or you do not have permission to view it.'
              : 'Please check your connection and try again.'}
          </Text>
          <TouchableOpacity style={styles.returnButton} onPress={() => router.back()}>
            <Text style={styles.returnButtonText}>Return to Calendar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!shift) return null;

  const startLux = DateTime.fromISO(shift.startsAt, { zone: clinicZone });
  const endLux = DateTime.fromISO(shift.endsAt, { zone: clinicZone });
  const isFuture = startLux > DateTime.now().setZone(clinicZone);
  const isAssignee = shift.assigneeId === currentUser?.id;
  const isPublished = shift.status === 'PUBLISHED';
  const canRequestSwap = isAssignee && isFuture && isPublished;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Shift Details</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Status & Position Card */}
          <View style={styles.heroCard}>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.statusBadge,
                  isPublished ? styles.statusBadgePublished : styles.statusBadgeDraft,
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    isPublished ? styles.statusBadgeTextPublished : styles.statusBadgeTextDraft,
                  ]}
                >
                  {shift.status}
                </Text>
              </View>
              <Text style={styles.versionText}>Version {shift.version}</Text>
            </View>

            <Text style={styles.positionTitle}>{shift.position}</Text>
            <Text style={styles.clinicName}>{activeClinic?.name}</Text>
          </View>

          {/* Timing Section */}
          <View style={styles.detailCard}>
            <Text style={styles.cardHeader}>📅 Date & Time</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Day:</Text>
              <Text style={styles.detailValue}>
                {startLux.toFormat('EEEE, d MMMM yyyy')}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Shift Window:</Text>
              <Text style={styles.detailValue}>
                {startLux.toFormat('HH:mm')} – {endLux.toFormat('HH:mm')} ({clinicZone})
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Duration:</Text>
              <Text style={styles.detailValue}>
                {endLux.diff(startLux, 'hours').hours} hours
              </Text>
            </View>
          </View>

          {/* Assignee Section */}
          <View style={styles.detailCard}>
            <Text style={styles.cardHeader}>👤 Assigned Staff</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Name:</Text>
              <Text style={styles.detailValue}>{shift.assignee?.name}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Role:</Text>
              <Text style={styles.detailValue}>{shift.assignee?.role}</Text>
            </View>
            {shift.assignee?.email && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Email:</Text>
                <Text style={styles.detailValue}>{shift.assignee?.email}</Text>
              </View>
            )}
          </View>

          {/* Notes Section */}
          <View style={styles.detailCard}>
            <Text style={styles.cardHeader}>📝 Handover Notes</Text>
            <Text style={styles.notesText}>
              {shift.notes ? shift.notes : 'No handover notes attached to this shift.'}
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsContainer}>
            {canRequestSwap && (
              <TouchableOpacity
                style={styles.swapButton}
                onPress={() => router.push(`/swaps/new?shiftId=${shift.id}` as any)}
                activeOpacity={0.8}
              >
                <Text style={styles.swapButtonText}>🔄 Request Swap with Colleague</Text>
              </TouchableOpacity>
            )}

            {isManagerOrOwner && (
              <>
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => router.push(`/shifts/edit?id=${shift.id}` as any)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.editButtonText}>✏️ Edit Shift</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={handleDelete}
                  disabled={deleteMutation.isPending}
                  activeOpacity={0.8}
                >
                  {deleteMutation.isPending ? (
                    <ActivityIndicator color={colors.onErrorContainer} />
                  ) : (
                    <Text style={styles.deleteButtonText}>🗑️ Delete Shift</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
  },
  loadingText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    marginTop: spacing.md,
  },
  notFoundIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  notFoundTitle: {
    ...typography.headlineMedium,
    color: colors.onSurface,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  notFoundSubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  returnButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  returnButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  heroCard: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.xs,
  },
  statusBadgeDraft: {
    backgroundColor: colors.surfaceContainerHighest,
  },
  statusBadgePublished: {
    backgroundColor: colors.primary,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadgeTextDraft: {
    color: colors.onSurface,
  },
  statusBadgeTextPublished: {
    color: colors.onPrimary,
  },
  versionText: {
    ...typography.labelSmall,
    color: colors.onPrimaryContainer,
    opacity: 0.8,
  },
  positionTitle: {
    ...typography.headlineLarge,
    fontSize: 24,
    color: colors.onPrimaryContainer,
    fontWeight: '800',
    marginBottom: 2,
  },
  clinicName: {
    ...typography.bodyMedium,
    color: colors.onPrimaryContainer,
    opacity: 0.9,
  },
  detailCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHeader: {
    ...typography.titleMedium,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  detailLabel: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    fontWeight: '500',
  },
  detailValue: {
    ...typography.bodyMedium,
    color: colors.onSurface,
    fontWeight: '700',
  },
  notesText: {
    ...typography.bodyMedium,
    color: colors.onSurface,
    lineHeight: 20,
  },
  actionsContainer: {
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
    gap: spacing.md,
  },
  swapButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
  },
  swapButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  editButton: {
    backgroundColor: colors.surfaceContainerHighest,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  editButtonText: {
    ...typography.labelLarge,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 16,
  },
  deleteButton: {
    backgroundColor: colors.errorContainer,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
  },
  deleteButtonText: {
    ...typography.labelLarge,
    color: colors.onErrorContainer,
    fontWeight: '700',
    fontSize: 15,
  },
});
