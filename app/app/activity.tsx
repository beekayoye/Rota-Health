import React, { useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { DateTime } from 'luxon';
import { apiClient, API_BASE_URL } from '../src/api/client';
import { useTeamStore } from '../src/state/team';
import { colors, spacing, radii, typography } from '../src/theme/tokens';
import { BottomNav } from '../src/components/BottomNav';

export interface ActivityPayload {
  actorName?: string;
  summary?: string;
  subjectType?: 'shift' | 'swap' | null;
  shiftId?: string;
  swapId?: string;
  seed?: boolean;
  [key: string]: any;
}

export interface ActivityItem {
  id: string;
  teamId: string;
  type: string;
  actorId: string;
  subjectId: string | null;
  payload: ActivityPayload;
  createdAt: string;
}

interface ActivityPageResponse {
  items: ActivityItem[];
  nextCursor: string | null;
}

function getActivityIcon(type: string): string {
  if (type.startsWith('shift.')) {
    if (type === 'shift.published') return '🚀';
    if (type === 'shift.updated') return '✏️';
    if (type === 'shift.deleted') return '🗑️';
    return '📅';
  }
  if (type.startsWith('swap.')) {
    if (type === 'swap.approved') return '✅';
    if (type === 'swap.declined' || type === 'swap.rejected') return '❌';
    if (type === 'swap.expired') return '⌛';
    return '🔄';
  }
  if (type.startsWith('member.')) return '👥';
  if (type.startsWith('billing.')) return '💳';
  return '📋';
}

function formatRelativeTime(isoString: string): string {
  try {
    const dt = DateTime.fromISO(isoString);
    if (!dt.isValid) return '';
    return dt.toRelative() || '';
  } catch {
    return '';
  }
}

export default function ActivityScreen() {
  const router = useRouter();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const clinics = useTeamStore((state) => state.clinics);
  const activeClinic = clinics.find((c) => c.id === activeTeamId);

  // 1. useInfiniteQuery per PRD 14, 17.6 & Part 6
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery<ActivityPageResponse>({
    queryKey: ['team', activeTeamId, 'activity'],
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as string | undefined;
      const url = cursor
        ? `${API_BASE_URL}/v1/teams/${activeTeamId}/activity?limit=20&cursor=${encodeURIComponent(cursor)}`
        : `${API_BASE_URL}/v1/teams/${activeTeamId}/activity?limit=20`;
      const res = await apiClient.get<ActivityPageResponse>(url);
      return res.data;
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(activeTeamId),
  });

  const allItems: ActivityItem[] = data ? data.pages.flatMap((page) => page.items) : [];

  // Fast-scroll safe onEndReached handler
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Handle tap on item
  const handleItemPress = useCallback(
    (item: ActivityItem) => {
      const subjectType = item.payload?.subjectType;
      const targetId = item.subjectId || item.payload?.shiftId || item.payload?.swapId;

      if (!targetId) return;

      if (subjectType === 'shift' || item.type.startsWith('shift.')) {
        router.push(`/shifts/${targetId}` as any);
      } else if (subjectType === 'swap' || item.type.startsWith('swap.')) {
        router.push(`/swaps/${targetId}` as any);
      }
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: ActivityItem }) => {
      const summary = item.payload?.summary || item.type;
      const actorName = item.payload?.actorName || 'Team Member';
      const relativeTime = formatRelativeTime(item.createdAt);
      const isActionable =
        Boolean(item.subjectId || item.payload?.shiftId || item.payload?.swapId) &&
        (item.payload?.subjectType === 'shift' ||
          item.payload?.subjectType === 'swap' ||
          item.type.startsWith('shift.') ||
          item.type.startsWith('swap.'));

      return (
        <TouchableOpacity
          style={styles.itemRow}
          onPress={() => handleItemPress(item)}
          disabled={!isActionable}
          activeOpacity={isActionable ? 0.7 : 1}
        >
          <View style={styles.iconContainer}>
            <Text style={styles.iconText}>{getActivityIcon(item.type)}</Text>
          </View>

          <View style={styles.contentCol}>
            <Text style={styles.summaryText} numberOfLines={2}>
              {summary}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.actorNameText} numberOfLines={1}>
                {actorName}
              </Text>
              {relativeTime ? (
                <>
                  <Text style={styles.metaDot}>•</Text>
                  <Text style={styles.timeText}>{relativeTime}</Text>
                </>
              ) : null}
            </View>
          </View>

          {isActionable && <Text style={styles.arrowText}>›</Text>}
        </TouchableOpacity>
      );
    },
    [handleItemPress],
  );

  const renderFooter = useCallback(() => {
    if (isFetchingNextPage) {
      return (
        <View style={styles.footerContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.footerLoadingText}>Loading older activity...</Text>
        </View>
      );
    }

    if (isFetchNextPageError) {
      return (
        <View style={styles.footerErrorContainer}>
          <Text style={styles.footerErrorText}>Couldn't load older items</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => fetchNextPage()}
            activeOpacity={0.8}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!hasNextPage && allItems.length > 0) {
      return (
        <View style={styles.caughtUpContainer}>
          <Text style={styles.caughtUpText}>✓ You're all caught up</Text>
        </View>
      );
    }

    return <View style={{ height: spacing.lg }} />;
  }, [isFetchingNextPage, isFetchNextPageError, hasNextPage, allItems.length, fetchNextPage]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Activity Feed</Text>
            <Text style={styles.headerSubtitle}>{activeClinic?.name || 'Clinic'}</Text>
          </View>
          {isRefetching && !isFetchingNextPage ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
        </View>

        {/* First Load Skeleton State */}
        {isLoading ? (
          <View style={styles.skeletonContainer}>
            {Array.from({ length: 6 }).map((_, idx) => (
              <View key={`skel-${idx}`} style={styles.skeletonRow}>
                <View style={styles.skeletonIcon} />
                <View style={styles.skeletonContent}>
                  <View style={styles.skeletonLineLong} />
                  <View style={styles.skeletonLineShort} />
                </View>
              </View>
            ))}
          </View>
        ) : isError ? (
          /* Initial Load Error */
          <View style={styles.centerBox}>
            <Text style={styles.emptyIcon}>⚠️</Text>
            <Text style={styles.emptyTitle}>Unable to load activity</Text>
            <Text style={styles.emptySubtitle}>
              {(error as any)?.response?.data?.error?.message ||
                'Please check your connection and try again.'}
            </Text>
            <TouchableOpacity style={styles.retryButtonLarge} onPress={() => refetch()}>
              <Text style={styles.retryButtonTextLarge}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : allItems.length === 0 ? (
          /* Empty State */
          <View style={styles.centerBox}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptySubtitle}>
              Shift publications, swap proposals, and member events will appear here in chronological order.
            </Text>
          </View>
        ) : (
          /* FlashList Virtualized Feed */
          <FlashList
            data={allItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.5}
            ListFooterComponent={renderFooter}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching && !isFetchingNextPage}
                onRefresh={refetch}
                colors={[colors.primary]}
                tintColor={colors.primary}
              />
            }
            contentContainerStyle={styles.listContent}
          />
        )}

        <BottomNav currentTab="activity" />
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
    fontSize: typography.headlineMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  headerSubtitle: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.md,
    marginVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerLow,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  iconText: {
    fontSize: 18,
  },
  contentCol: {
    flex: 1,
    justifyContent: 'center',
  },
  summaryText: {
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  actorNameText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    maxWidth: 160,
  },
  metaDot: {
    marginHorizontal: spacing.xs,
    color: colors.outline,
    fontSize: typography.bodySmall.fontSize,
  },
  timeText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.outline,
  },
  arrowText: {
    fontSize: 22,
    color: colors.outline,
    marginLeft: spacing.sm,
    fontWeight: '300',
  },
  footerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  footerLoadingText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
  },
  footerErrorContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  footerErrorText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.error,
  },
  retryButton: {
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  retryButtonText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.primary,
    fontWeight: '600',
  },
  caughtUpContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  caughtUpText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.outline,
    fontWeight: '500',
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.titleMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: typography.bodyMedium.fontSize,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButtonLarge: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  retryButtonTextLarge: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  skeletonContainer: {
    padding: spacing.lg,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginVertical: 4,
  },
  skeletonIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHigh,
    marginRight: spacing.md,
  },
  skeletonContent: {
    flex: 1,
  },
  skeletonLineLong: {
    height: 14,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.xs,
    width: '75%',
    marginBottom: 6,
  },
  skeletonLineShort: {
    height: 10,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.xs,
    width: '40%',
  },
});
