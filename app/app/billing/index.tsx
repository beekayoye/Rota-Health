import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { apiClient, API_BASE_URL } from '../../src/api/client';
import { useTeamStore } from '../../src/state/team';
import { colors, spacing, radii, typography } from '../../src/theme/tokens';

export interface BillingData {
  plan: 'STARTER' | 'TEAM' | 'BUSINESS';
  seats: number;
  seatsUsed: number;
  status: 'INCOMPLETE' | 'ACTIVE' | 'PAST_DUE' | 'RESTRICTED';
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  monthlyCents: number;
  monthlyPriceCents?: number;
  pendingChange?: {
    plan: 'STARTER' | 'TEAM' | 'BUSINESS';
    seats: number;
    effectiveAt?: string | null;
  } | null;
}

export default function BillingScreen() {
  const router = useRouter();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeRole = useTeamStore((state) => state.activeRole);
  const clinics = useTeamStore((state) => state.clinics);

  const activeClinic = clinics.find((c) => c.id === activeTeamId) || clinics[0];
  const isOwner = activeRole === 'OWNER';

  const {
    data: billing,
    isLoading,
    isError,
    refetch,
  } = useQuery<BillingData>({
    queryKey: ['team', activeTeamId, 'billing'],
    queryFn: async () => {
      const res = await apiClient.get(`${API_BASE_URL}/v1/teams/${activeTeamId}/billing`);
      return res.data;
    },
    enabled: !!activeTeamId && isOwner,
  });

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Billing</Text>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Owner Access Only</Text>
          <Text style={styles.emptySubtitle}>
            Subscription and billing information can only be viewed and managed by clinic Owners.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const formatPrice = (cents: number): string => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (dateStr?: string | null): string => {
    if (!dateStr) return '—';
    const dt = DateTime.fromISO(dateStr);
    return dt.isValid ? dt.toFormat('d LLL yyyy') : dateStr;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← More</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Plan & Billing</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Clinic Info */}
        <View style={styles.clinicCard}>
          <Text style={styles.clinicName}>{activeClinic?.name || 'Clinic'}</Text>
          <Text style={styles.clinicRoleBadge}>CLINIC OWNER</Text>
        </View>

        {isLoading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loaderText}>Loading billing details...</Text>
          </View>
        ) : isError || !billing ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Unable to load billing</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Status & Plan Overview Card */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardLabel}>CURRENT PLAN</Text>
                  <Text style={styles.planTitle}>{billing.plan}</Text>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    billing.status === 'ACTIVE'
                      ? styles.statusPillActive
                      : billing.status === 'INCOMPLETE'
                      ? styles.statusPillIncomplete
                      : styles.statusPillRestricted,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      billing.status === 'ACTIVE'
                        ? styles.statusPillTextActive
                        : billing.status === 'INCOMPLETE'
                        ? styles.statusPillTextIncomplete
                        : styles.statusPillTextRestricted,
                    ]}
                  >
                    {billing.status}
                  </Text>
                </View>
              </View>

              {/* Price Details */}
              <View style={styles.metricRow}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Monthly Price</Text>
                  <Text style={styles.metricValue}>
                    {formatPrice(billing.monthlyCents || billing.monthlyPriceCents || 0)}
                  </Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Next Renewal</Text>
                  <Text style={styles.metricValue}>{formatDate(billing.currentPeriodEnd)}</Text>
                </View>
              </View>

              {/* Seats breakdown */}
              <View style={styles.seatsSection}>
                <Text style={styles.metricLabel}>Purchased Capacity</Text>
                <Text style={styles.seatsText}>
                  <Text style={styles.seatsHighlight}>{billing.seatsUsed}</Text> of{' '}
                  <Text style={styles.seatsHighlight}>{billing.seats}</Text> seats used
                </Text>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${Math.min(
                          100,
                          billing.seats > 0 ? (billing.seatsUsed / billing.seats) * 100 : 0,
                        )}%`,
                      },
                    ]}
                  />
                </View>
              </View>

              {/* Pending Downgrade/Change Banner */}
              {billing.pendingChange && (
                <View style={styles.pendingCard}>
                  <Text style={styles.pendingTitle}>Scheduled Plan Change</Text>
                  <Text style={styles.pendingDesc}>
                    Your plan will change to {billing.pendingChange.plan} (
                    {billing.pendingChange.seats} seats) on{' '}
                    {formatDate(billing.pendingChange.effectiveAt || billing.currentPeriodEnd)}.
                  </Text>
                </View>
              )}
            </View>

            {/* Change Plan Button */}
            <TouchableOpacity
              style={styles.changePlanButton}
              onPress={() => router.push('/billing/change-plan' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.changePlanButtonText}>Change Plan & Seats</Text>
            </TouchableOpacity>

            {/* Plan Info Explainer */}
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Fair Per-Seat Billing</Text>
              <Text style={styles.infoText}>
                Mid-cycle seat and plan additions cost only the days left in your billing cycle.
                Downgrades take effect automatically at the end of your period with zero wasted days.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainer,
  },
  backButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  backButtonText: {
    fontSize: typography.bodyMedium.fontSize,
    color: colors.primary,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: typography.headlineMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  clinicCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  clinicName: {
    fontSize: typography.titleMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  clinicRoleBadge: {
    fontSize: typography.labelSmall.fontSize,
    fontWeight: '700',
    color: colors.onSecondaryContainer,
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.xs,
  },
  loaderContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  loaderText: {
    marginTop: spacing.md,
    color: colors.onSurfaceVariant,
    fontSize: typography.bodyMedium.fontSize,
  },
  errorCard: {
    backgroundColor: colors.surfaceContainerLowest,
    padding: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorTitle: {
    color: colors.error,
    fontSize: typography.bodyLarge.fontSize,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  retryButtonText: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
  },
  cardLabel: {
    fontSize: typography.labelSmall.fontSize,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  planTitle: {
    fontSize: typography.headlineMedium.fontSize,
    fontWeight: '800',
    color: colors.primary,
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  statusPillActive: {
    backgroundColor: '#dcfce7',
  },
  statusPillIncomplete: {
    backgroundColor: '#fef3c7',
  },
  statusPillRestricted: {
    backgroundColor: colors.errorContainer,
  },
  statusPillText: {
    fontSize: typography.labelSmall.fontSize,
    fontWeight: '700',
  },
  statusPillTextActive: {
    color: '#15803d',
  },
  statusPillTextIncomplete: {
    color: '#b45309',
  },
  statusPillTextRestricted: {
    color: colors.onErrorContainer,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
  },
  metricItem: {
    flex: 1,
  },
  metricLabel: {
    fontSize: typography.labelSmall.fontSize,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: typography.headlineMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  seatsSection: {
    paddingTop: spacing.md,
  },
  seatsText: {
    fontSize: typography.bodyMedium.fontSize,
    color: colors.onSurfaceVariant,
    marginVertical: 4,
  },
  seatsHighlight: {
    fontWeight: '700',
    color: colors.onSurface,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.full,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radii.full,
  },
  pendingCard: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  pendingTitle: {
    fontSize: typography.labelMedium.fontSize,
    fontWeight: '700',
    color: '#1d4ed8',
    marginBottom: 2,
  },
  pendingDesc: {
    fontSize: typography.bodySmall.fontSize,
    color: '#1e40af',
  },
  changePlanButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  changePlanButtonText: {
    color: colors.onPrimary,
    fontSize: typography.bodyLarge.fontSize,
    fontWeight: '700',
  },
  infoCard: {
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  infoTitle: {
    fontSize: typography.labelLarge.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  infoText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  emptyTitle: {
    fontSize: typography.headlineMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: typography.bodyMedium.fontSize,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
});
