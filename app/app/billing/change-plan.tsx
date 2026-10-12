import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import axios from 'axios';
import { apiClient, API_BASE_URL } from '../../src/api/client';
import { useTeamStore } from '../../src/state/team';
import { colors, spacing, radii, typography } from '../../src/theme/tokens';
import { BillingData } from './index';

type PlanName = 'STARTER' | 'TEAM' | 'BUSINESS';

interface PreviewResponse {
  kind: 'charge' | 'scheduled' | 'error';
  daysLeft?: number;
  creditCents?: number;
  costCents?: number;
  chargeCents?: number;
  newMonthlyCents?: number;
  effectiveAt?: string;
  code?: string;
}

export default function ChangePlanScreen() {
  const router = useRouter();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeRole = useTeamStore((state) => state.activeRole);

  const isOwner = activeRole === 'OWNER';

  // Fetch current billing data
  const { data: currentBilling } = useQuery<BillingData>({
    queryKey: ['team', activeTeamId, 'billing'],
    queryFn: async () => {
      const res = await apiClient.get(`${API_BASE_URL}/v1/teams/${activeTeamId}/billing`);
      return res.data;
    },
    enabled: !!activeTeamId && isOwner,
  });

  const [selectedPlan, setSelectedPlan] = useState<PlanName>('STARTER');
  const [selectedSeats, setSelectedSeats] = useState<number>(5);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Initialize from current plan
  useEffect(() => {
    if (currentBilling) {
      setSelectedPlan(currentBilling.plan);
      setSelectedSeats(currentBilling.seats);
    }
  }, [currentBilling]);

  // Handle plan change and update default seat bounds
  const handleSelectPlan = (plan: PlanName) => {
    setSelectedPlan(plan);
    if (plan === 'STARTER') {
      setSelectedSeats(5);
    } else if (plan === 'TEAM') {
      if (selectedSeats < 15) setSelectedSeats(15);
    } else if (plan === 'BUSINESS') {
      if (selectedSeats < 40) setSelectedSeats(40);
    }
  };

  // Fetch preview when selectedPlan or selectedSeats change
  useEffect(() => {
    if (!activeTeamId || !isOwner) return;

    let isCancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.post(
          `${API_BASE_URL}/v1/teams/${activeTeamId}/billing/changes/preview`,
          {
            plan: selectedPlan,
            seats: selectedSeats,
          },
        );
        if (!isCancelled) {
          setPreview(res.data);
          setPreviewError(null);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
            setPreviewError(err.response.data.error.message);
          } else {
            setPreviewError('Unable to calculate proration preview');
          }
          setPreview(null);
        }
      } finally {
        if (!isCancelled) {
          setPreviewLoading(false);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [activeTeamId, isOwner, selectedPlan, selectedSeats]);

  const formatPrice = (cents?: number): string => {
    if (typeof cents !== 'number') return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDateShort = (dateStr?: string | null): string => {
    if (!dateStr) return 'period end';
    const dt = DateTime.fromISO(dateStr);
    return dt.isValid ? dt.toFormat('d LLL') : dateStr;
  };

  const renewalDate = formatDateShort(
    preview?.effectiveAt || currentBilling?.currentPeriodEnd,
  );

  // PRD 11.3: Show "Business is cheaper" hint when Team seats >= 39
  const showBusinessCheaperHint = selectedPlan === 'TEAM' && selectedSeats >= 39;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Plan</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>1. Select Subscription Tier</Text>

        {/* Plan Cards */}
        <View style={styles.planSelector}>
          {/* STARTER */}
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'STARTER' && styles.planCardActive]}
            onPress={() => handleSelectPlan('STARTER')}
            activeOpacity={0.8}
          >
            <View style={styles.planCardHeader}>
              <Text
                style={[
                  styles.planCardTitle,
                  selectedPlan === 'STARTER' && styles.planCardTitleActive,
                ]}
              >
                Starter
              </Text>
              <Text
                style={[
                  styles.planPriceText,
                  selectedPlan === 'STARTER' && styles.planPriceTextActive,
                ]}
              >
                $20.00/mo
              </Text>
            </View>
            <Text style={styles.planDesc}>Up to 5 seats included. Great for small practices.</Text>
          </TouchableOpacity>

          {/* TEAM */}
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'TEAM' && styles.planCardActive]}
            onPress={() => handleSelectPlan('TEAM')}
            activeOpacity={0.8}
          >
            <View style={styles.planCardHeader}>
              <Text
                style={[styles.planCardTitle, selectedPlan === 'TEAM' && styles.planCardTitleActive]}
              >
                Team
              </Text>
              <Text
                style={[styles.planPriceText, selectedPlan === 'TEAM' && styles.planPriceTextActive]}
              >
                $50.00/mo
              </Text>
            </View>
            <Text style={styles.planDesc}>
              15 seats included, then $3.00 per extra seat.
            </Text>
          </TouchableOpacity>

          {/* BUSINESS */}
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'BUSINESS' && styles.planCardActive]}
            onPress={() => handleSelectPlan('BUSINESS')}
            activeOpacity={0.8}
          >
            <View style={styles.planCardHeader}>
              <Text
                style={[
                  styles.planCardTitle,
                  selectedPlan === 'BUSINESS' && styles.planCardTitleActive,
                ]}
              >
                Business
              </Text>
              <Text
                style={[
                  styles.planPriceText,
                  selectedPlan === 'BUSINESS' && styles.planPriceTextActive,
                ]}
              >
                $120.00/mo
              </Text>
            </View>
            <Text style={styles.planDesc}>
              40 seats included, then $2.00 per extra seat.
            </Text>
          </TouchableOpacity>
        </View>

        {/* PRD 11.3: Business is cheaper hint */}
        {showBusinessCheaperHint && (
          <View style={styles.cheaperHintCard}>
            <Text style={styles.cheaperHintTitle}>💡 Business is cheaper</Text>
            <Text style={styles.cheaperHintText}>
              At {selectedSeats} seats, upgrading to the Business plan ($120.00/mo for 40 seats)
              costs less than Team ($
              {((5000 + (selectedSeats - 15) * 300) / 100).toFixed(2)}/mo).
            </Text>
          </View>
        )}

        {/* Seat Counter */}
        <Text style={styles.sectionTitle}>2. Total Seats Needed</Text>
        <View style={styles.seatPickerCard}>
          <Text style={styles.seatPickerLabel}>Purchased Seats</Text>
          <View style={styles.stepperContainer}>
            <TouchableOpacity
              style={[
                styles.stepperBtn,
                (selectedSeats <= 1 || (selectedPlan === 'STARTER' && selectedSeats <= 1)) &&
                  styles.stepperBtnDisabled,
              ]}
              disabled={selectedSeats <= 1}
              onPress={() => setSelectedSeats(Math.max(1, selectedSeats - 1))}
            >
              <Text style={styles.stepperBtnText}>−</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.seatInput}
              keyboardType="number-pad"
              value={String(selectedSeats)}
              onChangeText={(val) => {
                const n = parseInt(val, 10);
                if (!isNaN(n)) {
                  if (selectedPlan === 'STARTER') {
                    setSelectedSeats(Math.min(5, Math.max(1, n)));
                  } else {
                    setSelectedSeats(Math.max(1, n));
                  }
                }
              }}
            />

            <TouchableOpacity
              style={[
                styles.stepperBtn,
                selectedPlan === 'STARTER' && selectedSeats >= 5 && styles.stepperBtnDisabled,
              ]}
              disabled={selectedPlan === 'STARTER' && selectedSeats >= 5}
              onPress={() => {
                if (selectedPlan === 'STARTER' && selectedSeats >= 5) return;
                setSelectedSeats(selectedSeats + 1);
              }}
            >
              <Text style={styles.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          {selectedPlan === 'STARTER' && (
            <Text style={styles.seatHelpText}>Starter plan supports a maximum of 5 seats.</Text>
          )}
        </View>

        {/* Preview Summary */}
        <Text style={styles.sectionTitle}>3. Pricing Breakdown</Text>
        <View style={styles.previewCard}>
          {previewLoading ? (
            <View style={styles.previewLoader}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.previewLoaderText}>Calculating proration...</Text>
            </View>
          ) : previewError ? (
            <View style={styles.previewMessageContainer}>
              <Text style={styles.previewErrorText}>{previewError}</Text>
            </View>
          ) : preview?.kind === 'charge' ? (
            <View>
              {/* Main Prompt Summary */}
              <Text style={styles.chargeHeadline}>
                You pay {formatPrice(preview.chargeCents)} today. From {renewalDate} you pay{' '}
                {formatPrice(preview.newMonthlyCents)} a month.
              </Text>

              {/* Exact breakdown */}
              <View style={styles.breakdownTable}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Remaining cycle</Text>
                  <Text style={styles.breakdownValue}>{preview.daysLeft} days</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Credit for unused days</Text>
                  <Text style={styles.breakdownValue}>{formatPrice(preview.creditCents)}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Cost of new configuration</Text>
                  <Text style={styles.breakdownValue}>{formatPrice(preview.costCents)}</Text>
                </View>
                <View style={[styles.breakdownRow, styles.breakdownRowTotal]}>
                  <Text style={styles.breakdownTotalLabel}>Due Today</Text>
                  <Text style={styles.breakdownTotalValue}>
                    {formatPrice(preview.chargeCents)}
                  </Text>
                </View>
              </View>
            </View>
          ) : preview?.kind === 'scheduled' ? (
            <View>
              <Text style={styles.scheduledHeadline}>
                Your plan changes on {formatDateShort(preview.effectiveAt)}. Nothing is charged
                today.
              </Text>
              <Text style={styles.scheduledSubline}>
                From {formatDateShort(preview.effectiveAt)}, your subscription renewal will be{' '}
                {formatPrice(preview.newMonthlyCents)} a month.
              </Text>
            </View>
          ) : null}
        </View>

        {/* Pay Button: stays disabled with specific prompt text */}
        <TouchableOpacity style={styles.disabledPayButton} disabled={true}>
          <Text style={styles.disabledPayButtonText}>Payments are added in the next step</Text>
        </TouchableOpacity>
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
  sectionTitle: {
    fontSize: typography.labelLarge.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  planSelector: {
    gap: spacing.sm,
  },
  planCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 2,
    borderColor: colors.surfaceContainer,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  planCardActive: {
    borderColor: colors.primary,
    backgroundColor: '#f0f6ff',
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  planCardTitle: {
    fontSize: typography.titleMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  planCardTitleActive: {
    color: colors.primary,
  },
  planPriceText: {
    fontSize: typography.titleMedium.fontSize,
    fontWeight: '800',
    color: colors.onSurfaceVariant,
  },
  planPriceTextActive: {
    color: colors.primary,
  },
  planDesc: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
  },
  cheaperHintCard: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  cheaperHintTitle: {
    fontSize: typography.labelMedium.fontSize,
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 2,
  },
  cheaperHintText: {
    fontSize: typography.bodySmall.fontSize,
    color: '#b45309',
    lineHeight: 18,
  },
  seatPickerCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  seatPickerLabel: {
    fontSize: typography.labelMedium.fontSize,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: {
    backgroundColor: colors.surfaceContainerHigh,
    opacity: 0.5,
  },
  stepperBtnText: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.onPrimaryContainer,
  },
  seatInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.sm,
    textAlign: 'center',
    fontSize: typography.headlineMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  seatHelpText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
    marginTop: spacing.xs,
  },
  previewCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    minHeight: 120,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  previewLoader: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  previewLoaderText: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
  },
  previewMessageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  previewErrorText: {
    fontSize: typography.bodyMedium.fontSize,
    color: colors.error,
    fontWeight: '600',
    textAlign: 'center',
  },
  chargeHeadline: {
    fontSize: typography.titleMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  breakdownTable: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHigh,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownRowTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHighest,
    paddingTop: spacing.xs,
    marginTop: spacing.xs,
  },
  breakdownLabel: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
  },
  breakdownValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
  },
  breakdownTotalLabel: {
    fontSize: typography.labelLarge.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  breakdownTotalValue: {
    fontSize: typography.titleMedium.fontSize,
    fontWeight: '800',
    color: colors.primary,
  },
  scheduledHeadline: {
    fontSize: typography.titleMedium.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
  scheduledSubline: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  disabledPayButton: {
    backgroundColor: colors.surfaceContainerHighest,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  disabledPayButtonText: {
    color: colors.onSurfaceVariant,
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '600',
  },
});
