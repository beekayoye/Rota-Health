import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { apiClient, API_BASE_URL } from '../../src/api/client';
import { useTeamStore } from '../../src/state/team';
import { colors, spacing, radii, typography } from '../../src/theme/tokens';
import { ShiftItem } from '../calendar';

export default function PublishReviewScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const clinics = useTeamStore((state) => state.clinics);
  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const clinicZone = activeClinic?.timeZone || 'Africa/Lagos';

  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load shifts for this week and next week to catch all drafts
  const weekStart = DateTime.now().setZone(clinicZone).startOf('week').toISODate()!;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['team', activeTeamId, 'shifts', weekStart],
    queryFn: async () => {
      const res = await apiClient.get(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/shifts?weekStart=${weekStart}`,
      );
      return res.data as { shifts: ShiftItem[] };
    },
    enabled: Boolean(activeTeamId),
  });

  const drafts = (data?.shifts || []).filter((s) => s.status === 'DRAFT');

  const handleToggleSelect = (id: string) => {
    setSelectedShiftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedShiftIds.size === drafts.length) {
      setSelectedShiftIds(new Set());
    } else {
      setSelectedShiftIds(new Set(drafts.map((d) => d.id)));
    }
  };

  const publishMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      if (selectedShiftIds.size === 0) {
        throw new Error('Please select at least one draft shift to publish');
      }

      // Generate UUID v4 for idempotency
      const idempotencyKey = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

      const res = await apiClient.post(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/shifts/publish`,
        { shiftIds: Array.from(selectedShiftIds) },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'shifts'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'shifts', 'upcoming'] });
      router.back();
    },
    onError: (err: any) => {
      setErrorMessage(err.response?.data?.error?.message || err.message || 'Failed to publish shifts');
    },
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Publish Review</Text>
          <View style={{ width: 60 }} />
        </View>

        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading draft shifts...</Text>
          </View>
        ) : drafts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No drafts to publish</Text>
            <Text style={styles.emptySubtitle}>
              All shifts are already published or no drafts have been created for this week.
            </Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => router.replace('/shifts/new' as any)}
            >
              <Text style={styles.createButtonText}>+ Create a New Draft</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.content}>
            {errorMessage && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {/* Select All Bar */}
            <View style={styles.selectAllBar}>
              <TouchableOpacity style={styles.selectAllButton} onPress={handleSelectAll}>
                <Text style={styles.checkboxIcon}>
                  {selectedShiftIds.size === drafts.length ? '☑️' : '◻️'}
                </Text>
                <Text style={styles.selectAllText}>
                  {selectedShiftIds.size === drafts.length ? 'Deselect All' : 'Select All'} (
                  {drafts.length})
                </Text>
              </TouchableOpacity>
              <Text style={styles.selectedCountText}>
                {selectedShiftIds.size} selected
              </Text>
            </View>

            {/* Drafts List */}
            <ScrollView contentContainerStyle={styles.listContent}>
              {drafts.map((shift) => {
                const isSelected = selectedShiftIds.has(shift.id);
                const startLux = DateTime.fromISO(shift.startsAt, { zone: clinicZone });
                const endLux = DateTime.fromISO(shift.endsAt, { zone: clinicZone });

                return (
                  <TouchableOpacity
                    key={shift.id}
                    style={[styles.draftCard, isSelected && styles.draftCardSelected]}
                    onPress={() => handleToggleSelect(shift.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cardCheckbox}>{isSelected ? '☑️' : '◻️'}</Text>
                    <View style={styles.cardDetails}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.cardPosition}>{shift.position}</Text>
                        <Text style={styles.cardDate}>{startLux.toFormat('ccc, d LLL')}</Text>
                      </View>
                      <Text style={styles.cardTime}>
                        ⏰ {startLux.toFormat('HH:mm')} – {endLux.toFormat('HH:mm')}
                      </Text>
                      <Text style={styles.cardAssignee}>
                        👤 {shift.assignee?.name || 'Unassigned'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Publish Selected Action Bar */}
            <View style={styles.publishActionBar}>
              <TouchableOpacity
                style={[
                  styles.publishButton,
                  (selectedShiftIds.size === 0 || publishMutation.isPending) &&
                    styles.publishButtonDisabled,
                ]}
                onPress={() => publishMutation.mutate()}
                disabled={selectedShiftIds.size === 0 || publishMutation.isPending}
                activeOpacity={0.8}
              >
                {publishMutation.isPending ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.publishButtonText}>
                    Publish Selected ({selectedShiftIds.size})
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
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
  content: {
    flex: 1,
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.headlineMedium,
    color: colors.onSurface,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  createButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
  },
  createButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: colors.errorContainer,
    marginHorizontal: spacing.xxl,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  errorText: {
    ...typography.bodyMedium,
    color: colors.onErrorContainer,
  },
  selectAllBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkboxIcon: {
    fontSize: 18,
  },
  selectAllText: {
    ...typography.labelMedium,
    color: colors.onSurface,
    fontWeight: '700',
  },
  selectedCountText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  listContent: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  draftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  draftCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  cardCheckbox: {
    fontSize: 22,
    marginRight: spacing.md,
  },
  cardDetails: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  cardPosition: {
    ...typography.titleMedium,
    color: colors.primary,
    fontWeight: '700',
  },
  cardDate: {
    ...typography.labelMedium,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  cardTime: {
    ...typography.bodyMedium,
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 2,
  },
  cardAssignee: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  publishActionBar: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
  },
  publishButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
  },
  publishButtonDisabled: {
    opacity: 0.5,
  },
  publishButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
});
