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

export interface SwapItem {
  id: string;
  teamId: string;
  requesterId: string;
  requester: { id: string; name: string; email?: string };
  targetUserId: string;
  targetUser: { id: string; name: string; email?: string };
  requesterShiftId: string;
  requesterShift: {
    id: string;
    position: string;
    startsAt: string;
    endsAt: string;
    notes?: string | null;
  };
  targetShiftId: string;
  targetShift: {
    id: string;
    position: string;
    startsAt: string;
    endsAt: string;
    notes?: string | null;
  };
  status: 'REQUESTED' | 'ACCEPTED' | 'DECLINED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  decidedBy?: string | null;
  reason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function SwapsScreen() {
  const router = useRouter();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeRole = useTeamStore((state) => state.activeRole);
  const clinics = useTeamStore((state) => state.clinics);
  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const clinicZone = activeClinic?.timeZone || 'Africa/Lagos';

  const isManagerOrOwner = activeRole === 'OWNER' || activeRole === 'MANAGER';

  const [segment, setSegment] = useState<'incoming' | 'outgoing' | 'approval'>('incoming');

  const {
    data: swaps,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<SwapItem[]>({
    queryKey: ['team', activeTeamId, 'swaps', segment],
    queryFn: async () => {
      if (!activeTeamId) return [];
      const res = await apiClient.get(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/swaps?box=${segment}`,
      );
      return res.data.swaps;
    },
    enabled: Boolean(activeTeamId),
  });

  const getStatusBadgeStyle = (status: SwapItem['status']) => {
    switch (status) {
      case 'REQUESTED':
        return { bg: '#e0e7ff', text: '#3730a3' }; // indigo
      case 'ACCEPTED':
        return { bg: '#dcfce7', text: '#15803d' }; // green
      case 'APPROVED':
        return { bg: colors.primaryContainer, text: colors.onPrimaryContainer };
      case 'DECLINED':
      case 'REJECTED':
      case 'CANCELLED':
        return { bg: colors.errorContainer, text: colors.onErrorContainer };
      case 'EXPIRED':
      default:
        return { bg: colors.surfaceContainerHighest, text: colors.onSurfaceVariant };
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Shift Swaps</Text>
          <Text style={styles.headerSubtitle}>{activeClinic?.name}</Text>
        </View>

        {/* Segmented Control Bar */}
        <View style={styles.segmentContainer}>
          <TouchableOpacity
            style={[styles.segmentBtn, segment === 'incoming' && styles.segmentBtnActive]}
            onPress={() => setSegment('incoming')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, segment === 'incoming' && styles.segmentTextActive]}>
              Incoming
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, segment === 'outgoing' && styles.segmentBtnActive]}
            onPress={() => setSegment('outgoing')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, segment === 'outgoing' && styles.segmentTextActive]}>
              Outgoing
            </Text>
          </TouchableOpacity>

          {isManagerOrOwner && (
            <TouchableOpacity
              style={[styles.segmentBtn, segment === 'approval' && styles.segmentBtnActive]}
              onPress={() => setSegment('approval')}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentText, segment === 'approval' && styles.segmentTextActive]}>
                Approval
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading swaps...</Text>
          </View>
        ) : isError ? (
          <View style={styles.centerContainer}>
            <Text style={styles.errorText}>Unable to load swaps.</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !swaps || swaps.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>
              {segment === 'incoming' ? '📥' : segment === 'outgoing' ? '📤' : '⚖️'}
            </Text>
            <Text style={styles.emptyTitle}>
              {segment === 'incoming'
                ? 'No incoming swap requests'
                : segment === 'outgoing'
                ? 'No outgoing swap requests'
                : 'No swaps awaiting approval'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {segment === 'incoming'
                ? 'When a colleague requests to swap shifts with you, the proposal will appear here for your review.'
                : segment === 'outgoing'
                ? 'You have not submitted any swap requests. Open any of your future shifts in the Calendar to propose a swap.'
                : 'When two staff members agree on a shift swap, it will appear here for Manager or Owner sign-off.'}
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
            {swaps.map((swap) => {
              const badge = getStatusBadgeStyle(swap.status);
              const rStart = DateTime.fromISO(swap.requesterShift.startsAt, { zone: clinicZone });
              const tStart = DateTime.fromISO(swap.targetShift.startsAt, { zone: clinicZone });

              return (
                <TouchableOpacity
                  key={swap.id}
                  style={styles.swapCard}
                  onPress={() => router.push(`/swaps/${swap.id}` as any)}
                  activeOpacity={0.8}
                >
                  <View style={styles.cardTopRow}>
                    <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: badge.text }]}>
                        {swap.status}
                      </Text>
                    </View>
                    <Text style={styles.cardTimeAgo}>
                      {DateTime.fromISO(swap.createdAt).toRelative() || ''}
                    </Text>
                  </View>

                  <View style={styles.partiesRow}>
                    <Text style={styles.partiesText}>
                      <Text style={styles.partyBold}>{swap.requester.name}</Text> ⇄{' '}
                      <Text style={styles.partyBold}>{swap.targetUser.name}</Text>
                    </Text>
                  </View>

                  {/* Shift Exchange Summary */}
                  <View style={styles.exchangeBox}>
                    <View style={styles.exchangeItem}>
                      <Text style={styles.exchangeLabel}>{swap.requester.name}'s Shift:</Text>
                      <Text style={styles.exchangeVal}>
                        {swap.requesterShift.position} • {rStart.toFormat('ccc, d LLL')} ({rStart.toFormat('HH:mm')})
                      </Text>
                    </View>

                    <Text style={styles.exchangeArrow}>↕</Text>

                    <View style={styles.exchangeItem}>
                      <Text style={styles.exchangeLabel}>{swap.targetUser.name}'s Shift:</Text>
                      <Text style={styles.exchangeVal}>
                        {swap.targetShift.position} • {tStart.toFormat('ccc, d LLL')} ({tStart.toFormat('HH:mm')})
                      </Text>
                    </View>
                  </View>

                  {swap.reason && (
                    <Text style={styles.reasonText} numberOfLines={2}>
                      Reason: "{swap.reason}"
                    </Text>
                  )}

                  <View style={styles.cardBottomRow}>
                    <Text style={styles.viewDetailText}>View Details →</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Global Bottom Navigation */}
        <BottomNav currentTab="swaps" />
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
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.xs,
    marginHorizontal: spacing.xxl,
    marginVertical: spacing.md,
    borderRadius: radii.lg,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radii.md,
  },
  segmentBtnActive: {
    backgroundColor: colors.surfaceContainerLowest,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  segmentText: {
    ...typography.labelMedium,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: colors.primary,
    fontWeight: '700',
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
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
  },
  retryBtnText: {
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
    paddingBottom: spacing.xxl,
  },
  swapCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 1,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  cardTimeAgo: {
    fontSize: 11,
    color: colors.onSurfaceVariant,
  },
  partiesRow: {
    marginBottom: spacing.xs,
  },
  partiesText: {
    ...typography.titleMedium,
    fontSize: 14,
    color: colors.onSurface,
  },
  partyBold: {
    fontWeight: '700',
    color: colors.primary,
  },
  exchangeBox: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginVertical: spacing.xs,
  },
  exchangeItem: {
    marginBottom: 2,
  },
  exchangeLabel: {
    fontSize: 11,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  exchangeVal: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSurface,
  },
  exchangeArrow: {
    textAlign: 'center',
    color: colors.primary,
    fontSize: 14,
    marginVertical: 2,
  },
  reasonText: {
    ...typography.bodySmall,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  cardBottomRow: {
    marginTop: spacing.sm,
    alignItems: 'flex-end',
  },
  viewDetailText: {
    ...typography.labelSmall,
    color: colors.primary,
    fontWeight: '700',
  },
});
