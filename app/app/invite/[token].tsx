import React, { useEffect, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { apiClient, API_BASE_URL, fetchMeAndSyncTeam } from '../../src/api/client';
import { useAuthStore } from '../../src/state/auth';
import { useTeamStore } from '../../src/state/team';
import { colors, spacing, radii, typography } from '../../src/theme/tokens';

interface InviteData {
  invite: {
    role: 'MANAGER' | 'STAFF';
    expiresAt: string;
    maxUses: number;
    uses: number;
    seatsAvailable: number;
  };
  team: {
    id: string;
    name: string;
    timeZone: string;
  };
}

export default function JoinScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();

  const { user, status } = useAuthStore();
  const setPendingInviteUrl = useTeamStore((state) => state.setPendingInviteUrl);
  const setActiveTeam = useTeamStore((state) => state.setActiveTeam);

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    setLoading(true);
    setErrorMessage(null);

    // Save token as pending invite so if user logs in or signs up, we return here
    setPendingInviteUrl(token);

    axios
      .get(`${API_BASE_URL}/v1/invites/${token}`)
      .then((res) => {
        if (!isMounted) return;
        setInviteData(res.data);
        if (res.data.invite.seatsAvailable === 0) {
          setIsFull(true);
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        if (axios.isAxiosError(err)) {
          const code = err.response?.data?.error?.code;
          const msg = err.response?.data?.error?.message;
          if (code === 'INVITE_EXPIRED') {
            setErrorMessage('This invite link has expired.');
          } else if (code === 'INVITE_USED') {
            setErrorMessage('This invite link has reached its maximum uses.');
          } else if (code === 'NOT_FOUND') {
            setErrorMessage('This invite link was not found or was revoked.');
          } else {
            setErrorMessage(msg || 'Unable to load invitation details.');
          }
        } else {
          setErrorMessage('Unable to load invitation details.');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [token, setPendingInviteUrl]);

  const handleAccept = async () => {
    if (!token) return;
    setJoining(true);
    setErrorMessage(null);

    try {
      const res = await apiClient.post(`${API_BASE_URL}/v1/invites/${token}/accept`);
      const { team, membership } = res.data;

      // Clear pending invite
      setPendingInviteUrl(null);

      // Refresh clinics list
      await fetchMeAndSyncTeam();

      // Set active clinic
      setActiveTeam(team.id, membership.role);

      router.replace('/home');
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const code = err.response?.data?.error?.code;
        const msg = err.response?.data?.error?.message;
        if (code === 'ALREADY_MEMBER') {
          setErrorMessage('You are already a member of this clinic.');
          setPendingInviteUrl(null);
          // Navigate to home after 1.5s
          setTimeout(() => router.replace('/home'), 1500);
        } else if (code === 'SEAT_LIMIT_EXCEEDED') {
          setErrorMessage('This clinic is full. Ask the person who invited you.');
          setIsFull(true);
        } else if (code === 'INVITE_EXPIRED') {
          setErrorMessage('This invite link has expired.');
        } else if (code === 'INVITE_USED') {
          setErrorMessage('This invite link has reached its maximum uses.');
        } else {
          setErrorMessage(msg || 'Failed to accept invite.');
        }
      } else {
        setErrorMessage('An unexpected error occurred.');
      }
    } finally {
      setJoining(false);
    }
  };

  const handleGoLogin = () => {
    if (token) setPendingInviteUrl(token);
    router.push('/login');
  };

  const handleGoRegister = () => {
    if (token) setPendingInviteUrl(token);
    router.push('/register');
  };

  const isAuthenticated = status === 'authenticated' && !!user;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.badgeContainer}>
          <Text style={styles.badge}>INVITATION</Text>
        </View>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading invitation details...</Text>
          </View>
        ) : errorMessage && !inviteData ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Invalid Invitation</Text>
            <Text style={styles.errorMessageText}>{errorMessage}</Text>
            <TouchableOpacity
              style={styles.homeButton}
              onPress={() => router.replace(isAuthenticated ? '/home' : '/')}
            >
              <Text style={styles.homeButtonText}>Go to Main Screen</Text>
            </TouchableOpacity>
          </View>
        ) : inviteData ? (
          <View>
            <Text style={styles.title}>Join {inviteData.team.name}</Text>
            <Text style={styles.subtitle}>
              You have been invited to join this clinic workspace as {inviteData.invite.role}.
            </Text>

            <View style={styles.detailsCard}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Clinic</Text>
                <Text style={styles.detailValue}>{inviteData.team.name}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Assigned Role</Text>
                <Text style={styles.detailValue}>{inviteData.invite.role}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Time Zone</Text>
                <Text style={styles.detailValue}>{inviteData.team.timeZone}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Available Seats</Text>
                <Text
                  style={[
                    styles.detailValue,
                    inviteData.invite.seatsAvailable === 0 && styles.seatWarning,
                  ]}
                >
                  {inviteData.invite.seatsAvailable > 0
                    ? `${inviteData.invite.seatsAvailable} remaining`
                    : 'Full'}
                </Text>
              </View>
            </View>

            {isFull ? (
              <View style={styles.warningContainer}>
                <Text style={styles.warningText}>
                  This clinic is full. Ask the person who invited you.
                </Text>
              </View>
            ) : null}

            {errorMessage && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {!isAuthenticated ? (
              <View style={styles.authNotice}>
                <Text style={styles.authNoticeTitle}>Sign in to accept this invitation</Text>
                <Text style={styles.authNoticeSubtitle}>
                  Please log in with your account or create a new account to join this clinic.
                </Text>

                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleGoLogin}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryButtonText}>Log In to Join</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={handleGoRegister}
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryButtonText}>Create New Account</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.acceptActions}>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    (joining || isFull) && styles.buttonDisabled,
                  ]}
                  onPress={handleAccept}
                  disabled={joining || isFull}
                  activeOpacity={0.8}
                >
                  {joining ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Accept & Join Clinic</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => router.replace('/home')}
                  disabled={joining}
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryButtonText}>Decline / Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : null}
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
    marginBottom: spacing.xxl,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
  detailsCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: spacing.xl,
    marginBottom: spacing.xl,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  detailLabel: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  detailValue: {
    ...typography.titleMedium,
    color: colors.onSurface,
  },
  seatWarning: {
    color: colors.error,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: spacing.sm,
  },
  centerBox: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    gap: spacing.md,
  },
  loadingText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  errorBox: {
    backgroundColor: colors.errorContainer,
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  errorTitle: {
    ...typography.headlineMedium,
    color: colors.onErrorContainer,
  },
  errorMessageText: {
    ...typography.bodyMedium,
    color: colors.onErrorContainer,
    textAlign: 'center',
  },
  homeButton: {
    marginTop: spacing.md,
    backgroundColor: colors.onErrorContainer,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
  },
  homeButtonText: {
    ...typography.labelLarge,
    color: colors.errorContainer,
  },
  warningContainer: {
    backgroundColor: colors.errorContainer,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.lg,
  },
  warningText: {
    ...typography.bodyMedium,
    color: colors.onErrorContainer,
    textAlign: 'center',
  },
  errorContainer: {
    backgroundColor: colors.errorContainer,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.bodyMedium,
    color: colors.onErrorContainer,
    textAlign: 'center',
  },
  authNotice: {
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  authNoticeTitle: {
    ...typography.titleMedium,
    color: colors.onSurface,
  },
  authNoticeSubtitle: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
  },
  acceptActions: {
    gap: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...typography.labelLarge,
    color: colors.onSurface,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
