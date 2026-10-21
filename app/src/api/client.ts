import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore, UserProfile } from '../state/auth';
import { useTeamStore, ClinicSummary } from '../state/team';
import {
  getStoredRefreshToken,
  saveRefreshToken,
  getOrCreateDeviceId,
  clearSecureStoreExceptDeviceId,
} from '../storage/secure-store';
import { queryClient } from './query-client';

import Constants from 'expo-constants';

function resolveApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/v1\/healthz\/?$/, '').replace(/\/+$/, '');
  }
  // Automatically extract host IP from Metro in development (works for physical devices on Wi-Fi)
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    return `http://${hostIp}:3000`;
  }
  return 'http://10.0.2.2:3000';
}

export const API_BASE_URL = resolveApiBaseUrl();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Single shared refresh promise to prevent concurrent refresh calls (PRD 14, 15.1)
let refreshPromise: Promise<string | null> | null = null;

export async function performLogout(): Promise<void> {
  // Clear Zustand stores
  useAuthStore.getState().clearAuth();
  useTeamStore.getState().clearTeam();

  // Clear query client cache
  queryClient.clear();

  // Clear SecureStore keys except rh.deviceId (PRD 14, prompt #5)
  await clearSecureStoreExceptDeviceId();
}

// Request Interceptor: Attach in-memory access token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const accessToken = useAuthStore.getState().accessToken;
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response Interceptor: Handle 401 TOKEN_EXPIRED with single shared refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    const is401 = error.response?.status === 401;
    const isAuthRoute =
      originalRequest?.url?.includes('/auth/login') ||
      originalRequest?.url?.includes('/auth/refresh') ||
      originalRequest?.url?.includes('/auth/register');

    if (is401 && originalRequest && !originalRequest._retry && !isAuthRoute) {
      originalRequest._retry = true;

      if (!refreshPromise) {
        refreshPromise = (async () => {
          try {
            const refreshToken = await getStoredRefreshToken();
            if (!refreshToken) {
              await performLogout();
              return null;
            }

            const deviceId = await getOrCreateDeviceId();

            // Direct call to refresh endpoint without interceptors
            const response = await axios.post(`${API_BASE_URL}/v1/auth/refresh`, {
              refreshToken,
              deviceId,
            });

            const { accessToken, refreshToken: newRefreshToken } = response.data;

            // Update in-memory Zustand store and SecureStore
            useAuthStore.getState().setAccessToken(accessToken);
            await saveRefreshToken(newRefreshToken);

            return accessToken as string;
          } catch {
            await performLogout();
            return null;
          } finally {
            refreshPromise = null;
          }
        })();
      }

      const newAccessToken = await refreshPromise;

      if (newAccessToken) {
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      }
    }

    return Promise.reject(error);
  },
);

/**
 * Bootstrap authentication on app cold start:
 * Checks for stored refresh token, refreshes in background, and fetches user.
 */
export async function bootstrapAuth(): Promise<UserProfile | null> {
  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) {
    useAuthStore.getState().setStatus('unauthenticated');
    return null;
  }

  useAuthStore.getState().setStatus('loading');

  try {
    const deviceId = await getOrCreateDeviceId();
    const refreshRes = await axios.post(`${API_BASE_URL}/v1/auth/refresh`, {
      refreshToken,
      deviceId,
    });

    const { accessToken, refreshToken: newRefreshToken } = refreshRes.data;
    useAuthStore.getState().setAccessToken(accessToken);
    await saveRefreshToken(newRefreshToken);

    // Fetch user profile and clinics
    const meRes = await axios.get(`${API_BASE_URL}/v1/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const user: UserProfile = meRes.data.user;
    const clinics: ClinicSummary[] = meRes.data.clinics || [];
    useAuthStore.getState().setAuth(user, accessToken);
    useTeamStore.getState().setClinics(clinics);
    return user;
  } catch {
    await performLogout();
    return null;
  }
}

/**
 * Fetch me and sync both auth and team stores.
 */
export async function fetchMeAndSyncTeam(): Promise<{
  user: UserProfile;
  clinics: ClinicSummary[];
}> {
  const res = await apiClient.get('/v1/me');
  const { user, clinics } = res.data;
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken) {
    useAuthStore.getState().setAuth(user, accessToken);
  }
  useTeamStore.getState().setClinics(clinics || []);
  return { user, clinics: clinics || [] };
}
