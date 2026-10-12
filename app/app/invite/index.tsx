import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { apiClient, API_BASE_URL } from '../../src/api/client';
import { useTeamStore } from '../../src/state/team';
import { generateUuid } from '../../src/utils/uuid';
import { colors, spacing, radii, typography } from '../../src/theme/tokens';

export default function InviteScreen() {
  const router = useRouter();
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeRole = useTeamStore((state) => state.activeRole);
  const clinics = useTeamStore((state) => state.clinics);

  const activeClinic = clinics.find((c) => c.id === activeTeamId);
  const isOwner = activeRole === 'OWNER';

  const [role, setRole] = useState<'MANAGER' | 'STAFF'>('STAFF');
  const [maxUses, setMaxUses] = useState('5');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generatedInvite, setGeneratedInvite] = useState<{
    id: string;
    role: string;
    maxUses: number;
    expiresAt: string;
    inviteUrl: string;
  } | null>(null);

  const handleGenerate = async () => {
    if (!activeTeamId) {
      setErrorMessage('No active clinic selected.');
      return;
    }

    const parsedUses = parseInt(maxUses, 10);
    if (isNaN(parsedUses) || parsedUses < 1 || parsedUses > 40) {
      setErrorMessage('Max uses must be an integer between 1 and 40.');
      return;
    }

    // Role check: Only Owner can invite Manager
    if (role === 'MANAGER' && !isOwner) {
      setErrorMessage('Only clinic Owners can invite Managers.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const idempotencyKey = generateUuid();
      const res = await apiClient.post(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/invites`,
        {
          mode: 'LINK',
          role,
          maxUses: parsedUses,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );

      const invite = res.data.invite;
      setGeneratedInvite(invite);

      // Open standard share sheet
      try {
        await Share.share({
          title: `Join ${activeClinic?.name || 'Clinic'} on Rota Health`,
          message: `You've been invited to join ${activeClinic?.name || 'our clinic'} on Rota Health as ${role}:\n${invite.inviteUrl}`,
          url: invite.inviteUrl,
        });
      } catch {
        // Ignore user cancellation of share sheet
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (err.response?.data?.error?.message) {
          setErrorMessage(err.response.data.error.message);
        } else {
          setErrorMessage('Failed to generate invite. Please try again.');
        }
      } else {
        setErrorMessage('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleShareAgain = async () => {
    if (!generatedInvite) return;
    try {
      await Share.share({
        title: `Join ${activeClinic?.name || 'Clinic'} on Rota Health`,
        message: `You've been invited to join ${activeClinic?.name || 'our clinic'} on Rota Health as ${generatedInvite.role}:\n${generatedInvite.inviteUrl}`,
        url: generatedInvite.inviteUrl,
      });
    } catch {
      // Ignore user cancellation
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back to Clinic</Text>
        </TouchableOpacity>

        <View style={styles.badgeContainer}>
          <Text style={styles.badge}>{activeClinic?.name || 'CLINIC'}</Text>
        </View>

        <Text style={styles.title}>Invite Team Members</Text>
        <Text style={styles.subtitle}>
          Create a reusable invite link. Invites expire in 7 days or after reaching capacity.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Role to Assign</Text>
          <View style={styles.rolePicker}>
            <TouchableOpacity
              style={[styles.roleOption, role === 'STAFF' && styles.roleOptionActive]}
              onPress={() => setRole('STAFF')}
              disabled={loading}
            >
              <Text style={[styles.roleTitle, role === 'STAFF' && styles.roleTitleActive]}>
                Staff
              </Text>
              <Text style={[styles.roleSubtitle, role === 'STAFF' && styles.roleSubtitleActive]}>
                View shifts & swap
              </Text>
            </TouchableOpacity>

            {isOwner && (
              <TouchableOpacity
                style={[styles.roleOption, role === 'MANAGER' && styles.roleOptionActive]}
                onPress={() => setRole('MANAGER')}
                disabled={loading}
              >
                <Text
                  style={[styles.roleTitle, role === 'MANAGER' && styles.roleTitleActive]}
                >
                  Manager
                </Text>
                <Text
                  style={[
                    styles.roleSubtitle,
                    role === 'MANAGER' && styles.roleSubtitleActive,
                  ]}
                >
                  Draft, publish & approve
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Maximum Uses (1 - 40)</Text>
          <TextInput
            style={styles.input}
            value={maxUses}
            onChangeText={setMaxUses}
            keyboardType="number-pad"
            maxLength={2}
            editable={!loading}
          />
          <Text style={styles.fieldHint}>
            E.g. set 1 for a single person, or 10 for a whole shift team.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleGenerate}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.submitButtonText}>Generate & Share Link</Text>
          )}
        </TouchableOpacity>

        {errorMessage && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {generatedInvite && (
          <View style={styles.inviteCard}>
            <Text style={styles.inviteCardTitle}>Invite Link Ready</Text>
            <Text style={styles.inviteCardUrl} numberOfLines={2}>
              {generatedInvite.inviteUrl}
            </Text>
            <View style={styles.inviteMeta}>
              <Text style={styles.inviteMetaText}>Role: {generatedInvite.role}</Text>
              <Text style={styles.inviteMetaText}>Max Uses: {generatedInvite.maxUses}</Text>
            </View>

            <TouchableOpacity style={styles.shareAgainButton} onPress={handleShareAgain}>
              <Text style={styles.shareAgainText}>Share Link Again</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
  },
  scrollContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  backButton: {
    paddingVertical: spacing.sm,
    marginBottom: spacing.xl,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    ...typography.labelLarge,
    color: colors.primary,
  },
  badgeContainer: {
    alignSelf: 'flex-start',
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    marginBottom: spacing.xl,
  },
  badge: {
    ...typography.labelSmall,
    color: colors.onSecondaryContainer,
  },
  title: {
    ...typography.headlineMedium,
    marginBottom: spacing.xs,
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyMedium,
    marginBottom: spacing.xxxl,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
  fieldGroup: {
    marginBottom: spacing.xxl,
  },
  label: {
    ...typography.titleMedium,
    fontSize: 13,
    marginBottom: spacing.sm,
    color: colors.onSurface,
  },
  rolePicker: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  roleOption: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  roleOptionActive: {
    backgroundColor: colors.primaryContainer,
    borderColor: colors.primary,
  },
  roleTitle: {
    ...typography.titleMedium,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  roleTitleActive: {
    color: colors.onPrimaryContainer,
  },
  roleSubtitle: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  roleSubtitleActive: {
    color: colors.onPrimaryContainer,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.bodyLarge,
    color: colors.onSurface,
  },
  fieldHint: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: spacing.xs,
  },
  submitButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
  },
  errorContainer: {
    backgroundColor: colors.errorContainer,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  errorText: {
    ...typography.bodyMedium,
    color: colors.onErrorContainer,
    textAlign: 'center',
  },
  inviteCard: {
    marginTop: spacing.xxxl,
    padding: spacing.xl,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  inviteCardTitle: {
    ...typography.titleMedium,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  inviteCardUrl: {
    ...typography.bodyMedium,
    fontSize: 13,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  inviteMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  inviteMetaText: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
  },
  shareAgainButton: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  shareAgainText: {
    ...typography.labelLarge,
    color: colors.primary,
  },
});
