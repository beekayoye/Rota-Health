import React, { useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/state/auth';
import { useTeamStore } from '../src/state/team';
import { colors, spacing, radii, typography } from '../src/theme/tokens';

export default function WelcomeScreen() {
  const router = useRouter();
  const { status, user } = useAuthStore();
  const clinics = useTeamStore((state) => state.clinics);
  const pendingInviteUrl = useTeamStore((state) => state.pendingInviteUrl);

  useEffect(() => {
    if (status === 'authenticated' && user) {
      if (pendingInviteUrl) {
        router.replace(`/invite/${pendingInviteUrl}` as any);
      } else if (clinics.length === 0) {
        router.replace('/create-clinic' as any);
      } else {
        router.replace('/home');
      }
    }
  }, [status, user, clinics.length, pendingInviteUrl, router]);

  if (status === 'loading') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.heroSection}>
          <View style={styles.badgeContainer}>
            <Text style={styles.badge}>ROTA HEALTH</Text>
          </View>
          <Text style={styles.title}>Shift scheduling for clinics that never close.</Text>
          <Text style={styles.subtitle}>
            One trusted schedule, approved swaps, sleep-respecting alerts, and offline access.
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push('/register')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Create an Account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/login')}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>Log In</Text>
          </TouchableOpacity>
        </View>
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
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
    justifyContent: 'space-between',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroSection: {
    flex: 1,
    justifyContent: 'center',
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
    ...typography.headlineLarge,
    marginBottom: spacing.lg,
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.onSurfaceVariant,
    lineHeight: 24,
  },
  actions: {
    gap: spacing.md,
    paddingBottom: spacing.md,
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
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  secondaryButtonText: {
    ...typography.labelLarge,
    color: colors.onSurface,
  },
});
