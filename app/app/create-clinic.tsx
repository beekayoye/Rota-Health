import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { apiClient, API_BASE_URL, fetchMeAndSyncTeam } from '../src/api/client';
import { useTeamStore } from '../src/state/team';
import { generateUuid } from '../src/utils/uuid';
import { colors, spacing, radii, typography } from '../src/theme/tokens';

const COMMON_TIMEZONES = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/London',
  'UTC',
];

export default function CreateClinicScreen() {
  const router = useRouter();
  const setActiveTeam = useTeamStore((state) => state.setActiveTeam);
  const pendingInviteUrl = useTeamStore((state) => state.pendingInviteUrl);
  const clinics = useTeamStore((state) => state.clinics);

  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('Africa/Lagos');
  const [inviteTokenInput, setInviteTokenInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setErrorMessage('Please enter your clinic or facility name.');
      return;
    }

    if (!timeZone.trim()) {
      setErrorMessage('Please select or specify a valid time zone.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const idempotencyKey = generateUuid();
      const res = await apiClient.post(
        `${API_BASE_URL}/v1/teams`,
        {
          name: name.trim(),
          timeZone: timeZone.trim(),
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );

      const createdTeam = res.data.team;

      // Sync fresh clinics list from backend
      await fetchMeAndSyncTeam();

      // Set newly created clinic as active with OWNER role
      setActiveTeam(createdTeam.id, 'OWNER');

      if (pendingInviteUrl) {
        router.replace(`/invite/${pendingInviteUrl}` as any);
      } else {
        router.replace('/home');
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (err.response?.data?.error?.message) {
          setErrorMessage(err.response.data.error.message);
        } else if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
          setErrorMessage('Request timed out. Please try again.');
        } else {
          setErrorMessage('Failed to create clinic. Please verify your connection.');
        }
      } else {
        setErrorMessage('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {clinics.length > 0 && (
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backButtonText}>← Back to Home</Text>
            </TouchableOpacity>
          )}

          <View style={styles.badgeContainer}>
            <Text style={styles.badge}>NEW CLINIC SETUP</Text>
          </View>

          <Text style={styles.title}>Set up your Clinic</Text>
          <Text style={styles.subtitle}>
            Create your clinic workspace to start scheduling shifts and inviting your team.
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Clinic or Hospital Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. St. Jude Memorial Clinic"
              placeholderTextColor={colors.outline}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              editable={!loading}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Clinic Time Zone</Text>
            <TextInput
              style={styles.input}
              placeholder="Africa/Lagos"
              placeholderTextColor={colors.outline}
              value={timeZone}
              onChangeText={setTimeZone}
              autoCapitalize="none"
              editable={!loading}
            />
            <Text style={styles.fieldHint}>Quick presets:</Text>
            <View style={styles.timezoneRow}>
              {COMMON_TIMEZONES.slice(0, 4).map((tz) => (
                <TouchableOpacity
                  key={tz}
                  style={[styles.tzChip, timeZone === tz && styles.tzChipActive]}
                  onPress={() => setTimeZone(tz)}
                  disabled={loading}
                >
                  <Text
                    style={[styles.tzChipText, timeZone === tz && styles.tzChipTextActive]}
                  >
                    {tz.replace('Africa/', '')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleCreate}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.submitButtonText}>Create Clinic & Continue</Text>
            )}
          </TouchableOpacity>

          {/* Join via Invite Code alternative */}
          <View style={styles.inviteJoinDivider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.inviteJoinCard}>
            <Text style={styles.inviteJoinTitle}>Invited by a Clinic?</Text>
            <Text style={styles.inviteJoinSubtitle}>
              Paste your invite token or link below to join an existing clinic workspace.
            </Text>
            <View style={styles.inviteInputRow}>
              <TextInput
                style={styles.inviteInput}
                placeholder="Paste token or link"
                placeholderTextColor={colors.outline}
                value={inviteTokenInput}
                onChangeText={setInviteTokenInput}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.inviteJoinButton}
                onPress={() => {
                  if (inviteTokenInput.trim()) {
                    let token = inviteTokenInput.trim();
                    const match = token.match(/invite\/([^/?#]+)/);
                    if (match) token = match[1];
                    router.push(`/invite/${token}` as any);
                  }
                }}
              >
                <Text style={styles.inviteJoinButtonText}>Join</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxxl,
  },
  badgeContainer: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    marginBottom: spacing.xl,
  },
  badge: {
    ...typography.labelSmall,
    color: colors.onPrimaryContainer,
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
    marginBottom: spacing.xs,
    color: colors.onSurface,
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
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  timezoneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tzChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  tzChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tzChipText: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
  },
  tzChipTextActive: {
    color: colors.onPrimary,
  },
  submitButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: spacing.xl,
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
  backButton: {
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    ...typography.labelLarge,
    color: colors.primary,
  },
  inviteJoinDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xxl,
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
  dividerText: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
  },
  inviteJoinCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  inviteJoinTitle: {
    ...typography.headlineMedium,
    fontSize: 16,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  inviteJoinSubtitle: {
    ...typography.bodyMedium,
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.md,
  },
  inviteInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inviteInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.bodyMedium,
    color: colors.onSurface,
  },
  inviteJoinButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.md,
  },
  inviteJoinButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
  },
});
