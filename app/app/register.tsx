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
import { useAuthStore } from '../src/state/auth';
import { useTeamStore } from '../src/state/team';
import { getOrCreateDeviceId, saveRefreshToken } from '../src/storage/secure-store';
import { colors, spacing, radii, typography } from '../src/theme/tokens';

export default function RegisterScreen() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) {
      setErrorMessage('Please fill in all fields');
      return;
    }

    if (password.length < 10) {
      setErrorMessage('Password must be at least 10 characters long');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const deviceId = await getOrCreateDeviceId();
      const res = await apiClient.post(`${API_BASE_URL}/v1/auth/register`, {
        name: name.trim(),
        email: email.trim(),
        password,
        deviceId,
      });

      const { user, accessToken, refreshToken } = res.data;

      // Persist refresh token in SecureStore
      await saveRefreshToken(refreshToken);

      // Save user & accessToken in memory
      setAuth(user, accessToken);

      // Sync clinics from GET /v1/me
      const { clinics } = await fetchMeAndSyncTeam();

      const pendingInvite = useTeamStore.getState().pendingInviteUrl;
      if (pendingInvite) {
        router.replace(`/invite/${pendingInvite}` as any);
      } else if (clinics.length === 0) {
        router.replace('/create-clinic' as any);
      } else {
        router.replace('/home');
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (err.response?.data?.error?.message) {
          setErrorMessage(err.response.data.error.message);
        } else if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
          setErrorMessage('Request timed out. Please verify the API server is running.');
        } else if (err.message === 'Network Error' || !err.response) {
          setErrorMessage(
            `Cannot connect to server at ${API_BASE_URL}. Ensure the backend is running.`,
          );
        } else {
          setErrorMessage('Unable to register. Please try again.');
        }
      } else {
        setErrorMessage('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
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
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join your clinic shift schedule</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Dr. Ngozi Eze"
              placeholderTextColor={colors.outline}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              editable={!loading}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="nurse@clinic.org"
              placeholderTextColor={colors.outline}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password (minimum 10 characters)</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••••••"
              placeholderTextColor={colors.outline}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.submitButtonText}>Sign Up</Text>
            )}
          </TouchableOpacity>

          {errorMessage && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.footerLink}
            onPress={() => router.replace('/login')}
            disabled={loading}
          >
            <Text style={styles.footerLinkText}>
              Already have an account? <Text style={styles.footerLinkHighlight}>Log In</Text>
            </Text>
          </TouchableOpacity>
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
  title: {
    ...typography.headlineMedium,
    marginBottom: spacing.xs,
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyMedium,
    marginBottom: spacing.xxxl,
    color: colors.onSurfaceVariant,
  },
  fieldGroup: {
    marginBottom: spacing.xl,
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
  footerLink: {
    marginTop: spacing.xxxl,
    alignItems: 'center',
  },
  footerLinkText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  footerLinkHighlight: {
    color: colors.primary,
    fontWeight: '700',
  },
});
