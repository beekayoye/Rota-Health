import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
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
import { SwapItem } from '../swaps';

export default function SwapDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentUser = useAuthStore((state) => state.user);
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeRole = useTeamStore((state) => state.activeRole);
  const clinics = useTeamStore((state) => state.clinics);
  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const clinicZone = activeClinic?.timeZone || 'Africa/Lagos';

  const isOwner = activeRole === 'OWNER';
  const isManager = activeRole === 'MANAGER';
  const isManagerOrOwner = isOwner || isManager;

  // Reason modal state (for Decline and Reject)
  const [modalAction, setModalAction] = useState<'decline' | 'reject' | null>(null);
  const [reasonText, setReasonText] = useState('');

  const {
    data: swap,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<SwapItem>({
    queryKey: ['team', activeTeamId, 'swap', id],
    queryFn: async () => {
      const res = await apiClient.get(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/swaps/${id}`,
      );
      return res.data.swap;
    },
    enabled: Boolean(activeTeamId && id),
    retry: false,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'swaps'] });
    queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'swap', id] });
    queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'shifts'] });
    queryClient.invalidateQueries({ queryKey: ['me', 'shifts', 'upcoming'] });
  };

  // 1. Accept Mutation
  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/swaps/${id}/accept`,
      );
      return res.data;
    },
    onSuccess: () => {
      invalidateAll();
      Alert.alert('Accepted', 'You have accepted this shift swap. It is now awaiting management approval.');
    },
    onError: (err: any) => {
      Alert.alert('Error', err.response?.data?.error?.message || 'Could not accept swap');
    },
  });

  // 2. Decline Mutation
  const declineMutation = useMutation({
    mutationFn: async (reason?: string) => {
      const res = await apiClient.post(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/swaps/${id}/decline`,
        { reason: reason?.trim() || undefined },
      );
      return res.data;
    },
    onSuccess: () => {
      setModalAction(null);
      setReasonText('');
      invalidateAll();
      Alert.alert('Declined', 'You have declined this shift swap request.');
    },
    onError: (err: any) => {
      Alert.alert('Error', err.response?.data?.error?.message || 'Could not decline swap');
    },
  });

  // 3. Cancel Mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/swaps/${id}/cancel`,
      );
      return res.data;
    },
    onSuccess: () => {
      invalidateAll();
      Alert.alert('Cancelled', 'You have cancelled your shift swap proposal.');
    },
    onError: (err: any) => {
      Alert.alert('Error', err.response?.data?.error?.message || 'Could not cancel swap');
    },
  });

  // 4. Approve Mutation (Requires Idempotency-Key per PRD 10)
  const approveMutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

      const res = await apiClient.post(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/swaps/${id}/approve`,
        {},
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      return res.data;
    },
    onSuccess: () => {
      invalidateAll();
      Alert.alert('Approved', 'Shift swap has been approved. Assignees have been updated on both shifts.');
    },
    onError: (err: any) => {
      Alert.alert('Error', err.response?.data?.error?.message || 'Could not approve swap');
    },
  });

  // 5. Reject Mutation
  const rejectMutation = useMutation({
    mutationFn: async (reason?: string) => {
      const res = await apiClient.post(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/swaps/${id}/reject`,
        { reason: reason?.trim() || undefined },
      );
      return res.data;
    },
    onSuccess: () => {
      setModalAction(null);
      setReasonText('');
      invalidateAll();
      Alert.alert('Rejected', 'Shift swap proposal has been rejected.');
    },
    onError: (err: any) => {
      Alert.alert('Error', err.response?.data?.error?.message || 'Could not reject swap');
    },
  });

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading swap proposal...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !swap) {
    const is404 = axios.isAxiosError(error) && error.response?.status === 404;
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Swap Details</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.notFoundIcon}>⚠️</Text>
          <Text style={styles.notFoundTitle}>
            {is404 ? 'SWAP_NOT_FOUND' : 'Unable to load swap'}
          </Text>
          <Text style={styles.notFoundSubtitle}>
            This swap request does not exist, has expired, or you do not have permission to view it.
          </Text>
          <TouchableOpacity style={styles.returnButton} onPress={() => router.back()}>
            <Text style={styles.returnButtonText}>Return</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isRequester = swap.requesterId === currentUser?.id;
  const isTarget = swap.targetUserId === currentUser?.id;
  const isParty = isRequester || isTarget;

  // Manager self-approval restriction (PRD 6.4, PRD 7)
  const isManagerPartyBlocked = isManager && isParty;

  const canTargetAcceptOrDecline = isTarget && swap.status === 'REQUESTED';
  const canRequesterCancel = isRequester && (swap.status === 'REQUESTED' || swap.status === 'ACCEPTED');
  const canApproveOrReject = isManagerOrOwner && swap.status === 'ACCEPTED' && !isManagerPartyBlocked;

  const rStart = DateTime.fromISO(swap.requesterShift.startsAt, { zone: clinicZone });
  const rEnd = DateTime.fromISO(swap.requesterShift.endsAt, { zone: clinicZone });
  const tStart = DateTime.fromISO(swap.targetShift.startsAt, { zone: clinicZone });
  const tEnd = DateTime.fromISO(swap.targetShift.endsAt, { zone: clinicZone });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Swap Proposal</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Status Header Banner */}
          <View style={styles.statusBanner}>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>{swap.status}</Text>
            </View>
            <Text style={styles.statusDate}>
              Created {DateTime.fromISO(swap.createdAt).toFormat('d LLL yyyy, HH:mm')}
            </Text>
          </View>

          {swap.reason && (
            <View style={styles.reasonCard}>
              <Text style={styles.reasonTitle}>Note / Reason:</Text>
              <Text style={styles.reasonBody}>"{swap.reason}"</Text>
            </View>
          )}

          {isManagerPartyBlocked && swap.status === 'ACCEPTED' && (
            <View style={styles.blockedNoticeBox}>
              <Text style={styles.blockedNoticeText}>
                ⚠️ As you are party to this swap, another manager or clinic owner must approve or reject it.
              </Text>
            </View>
          )}

          {/* Side by Side Shift Comparison */}
          <Text style={styles.sectionHeading}>Proposed Exchange</Text>

          {/* Requester Shift Box */}
          <View style={styles.shiftCard}>
            <View style={styles.shiftCardHeader}>
              <Text style={styles.cardTag}>OFFERED BY</Text>
              <Text style={styles.cardPersonName}>👤 {swap.requester.name}</Text>
            </View>
            <Text style={styles.shiftPos}>{swap.requesterShift.position}</Text>
            <Text style={styles.shiftDate}>📅 {rStart.toFormat('EEEE, d LLL yyyy')}</Text>
            <Text style={styles.shiftTime}>⏰ {rStart.toFormat('HH:mm')} – {rEnd.toFormat('HH:mm')} ({clinicZone})</Text>
            {swap.requesterShift.notes ? (
              <Text style={styles.shiftNotes}>📝 {swap.requesterShift.notes}</Text>
            ) : null}
          </View>

          {/* Divider */}
          <View style={styles.exchangeIndicator}>
            <Text style={styles.exchangeIndicatorText}>⇅ Swapping With ⇅</Text>
          </View>

          {/* Target Shift Box */}
          <View style={styles.shiftCard}>
            <View style={styles.shiftCardHeader}>
              <Text style={styles.cardTag}>TARGET SHIFT</Text>
              <Text style={styles.cardPersonName}>👤 {swap.targetUser.name}</Text>
            </View>
            <Text style={styles.shiftPos}>{swap.targetShift.position}</Text>
            <Text style={styles.shiftDate}>📅 {tStart.toFormat('EEEE, d LLL yyyy')}</Text>
            <Text style={styles.shiftTime}>⏰ {tStart.toFormat('HH:mm')} – {tEnd.toFormat('HH:mm')} ({clinicZone})</Text>
            {swap.targetShift.notes ? (
              <Text style={styles.shiftNotes}>📝 {swap.targetShift.notes}</Text>
            ) : null}
          </View>

          {/* Action Buttons based on Role & State */}
          <View style={styles.actionButtonsContainer}>
            {/* Target Actions on REQUESTED */}
            {canTargetAcceptOrDecline && (
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.declineBtn]}
                  onPress={() => setModalAction('decline')}
                >
                  <Text style={styles.declineBtnText}>Decline</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.acceptBtn]}
                  onPress={() => acceptMutation.mutate()}
                  disabled={acceptMutation.isPending}
                >
                  {acceptMutation.isPending ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.acceptBtnText}>Accept Swap</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Requester Action on REQUESTED / ACCEPTED */}
            {canRequesterCancel && (
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? (
                  <ActivityIndicator color={colors.onErrorContainer} />
                ) : (
                  <Text style={styles.cancelBtnText}>Cancel Swap Request</Text>
                )}
              </TouchableOpacity>
            )}

            {/* Management Actions on ACCEPTED */}
            {canApproveOrReject && (
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rejectBtn]}
                  onPress={() => setModalAction('reject')}
                >
                  <Text style={styles.rejectBtnText}>Reject</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn]}
                  onPress={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending}
                >
                  {approveMutation.isPending ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.approveBtnText}>Approve Swap</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Reason Modal for Decline / Reject */}
        <Modal
          visible={modalAction !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setModalAction(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {modalAction === 'decline' ? 'Decline Swap Request' : 'Reject Swap Proposal'}
              </Text>
              <Text style={styles.modalSubtitle}>
                You may optionally provide a reason for the parties:
              </Text>
              <TextInput
                style={styles.modalInput}
                value={reasonText}
                onChangeText={setReasonText}
                placeholder="Reason (optional, max 280 characters)..."
                placeholderTextColor={colors.outline}
                multiline
                numberOfLines={3}
                maxLength={280}
              />
              <View style={styles.modalButtonRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => {
                    setModalAction(null);
                    setReasonText('');
                  }}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalConfirmBtn}
                  onPress={() => {
                    if (modalAction === 'decline') {
                      declineMutation.mutate(reasonText);
                    } else if (modalAction === 'reject') {
                      rejectMutation.mutate(reasonText);
                    }
                  }}
                >
                  <Text style={styles.modalConfirmText}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
    marginTop: spacing.sm,
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
  statusBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.md,
    borderRadius: radii.lg,
    marginBottom: spacing.md,
  },
  statusBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.onPrimary,
  },
  statusDate: {
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  reasonCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  reasonTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
    marginBottom: 2,
  },
  reasonBody: {
    ...typography.bodyMedium,
    color: colors.onSurface,
    fontStyle: 'italic',
  },
  blockedNoticeBox: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffeeba',
    borderWidth: 1,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  blockedNoticeText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '600',
    lineHeight: 18,
  },
  sectionHeading: {
    ...typography.titleMedium,
    fontWeight: '800',
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  shiftCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  shiftCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cardTag: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  cardPersonName: {
    ...typography.titleMedium,
    fontWeight: '700',
    color: colors.onSurface,
  },
  shiftPos: {
    ...typography.headlineMedium,
    fontSize: 18,
    color: colors.primary,
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
  },
  shiftNotes: {
    ...typography.bodySmall,
    color: colors.onSurfaceVariant,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  exchangeIndicator: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  exchangeIndicatorText: {
    ...typography.labelMedium,
    color: colors.primary,
    fontWeight: '800',
  },
  actionButtonsContainer: {
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
  },
  acceptBtn: {
    backgroundColor: colors.primary,
  },
  acceptBtnText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  declineBtn: {
    backgroundColor: colors.errorContainer,
  },
  declineBtnText: {
    ...typography.labelLarge,
    color: colors.onErrorContainer,
    fontWeight: '700',
  },
  cancelBtn: {
    backgroundColor: colors.surfaceContainerHighest,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
  },
  cancelBtnText: {
    ...typography.labelLarge,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
  },
  approveBtn: {
    backgroundColor: colors.primary,
  },
  approveBtnText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  rejectBtn: {
    backgroundColor: colors.errorContainer,
  },
  rejectBtnText: {
    ...typography.labelLarge,
    color: colors.onErrorContainer,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    ...typography.headlineMedium,
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  modalInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: 14,
    color: colors.onSurface,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: spacing.lg,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  modalCancelBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  modalCancelText: {
    ...typography.labelLarge,
    color: colors.onSurfaceVariant,
  },
  modalConfirmBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  modalConfirmText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
    fontWeight: '700',
  },
});
