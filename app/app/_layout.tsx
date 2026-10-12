import React, { useEffect, useCallback } from 'react';
import { Stack, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/api/query-client';
import { bootstrapAuth } from '../src/api/client';
import { useAuthStore } from '../src/state/auth';
import { useTeamStore } from '../src/state/team';
import { registerForPushNotificationsAsync } from '../src/notifications/register';

export default function RootLayout() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const setStatus = useAuthStore((state) => state.setStatus);
  const setPendingInviteUrl = useTeamStore((state) => state.setPendingInviteUrl);
  const setPendingUrl = useTeamStore((state) => state.setPendingUrl);
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const setActiveTeam = useTeamStore((state) => state.setActiveTeam);

  const handleDeepLink = useCallback((url: string | null) => {
    if (!url) return;
    try {
      const parsed = Linking.parse(url);

      if (parsed.path) {
        const inviteMatch = parsed.path.match(/invite\/([^/?#]+)/);
        if (inviteMatch) {
          setPendingInviteUrl(inviteMatch[1]);
          router.push(`/invite/${inviteMatch[1]}` as any);
          return;
        }

        const shiftMatch = parsed.path.match(/shifts\/([^/?#]+)/);
        if (shiftMatch) {
          router.push(`/shifts/${shiftMatch[1]}` as any);
          return;
        }

        const swapMatch = parsed.path.match(/swaps\/([^/?#]+)/);
        if (swapMatch) {
          router.push(`/swaps/${swapMatch[1]}` as any);
          return;
        }

        if (parsed.path.includes('calendar')) {
          router.push('/calendar' as any);
          return;
        }

        if (parsed.path.includes('billing')) {
          router.push('/more' as any);
          return;
        }
      }

      if (parsed.hostname === 'invite' && parsed.path) {
        const t = parsed.path.replace(/^\//, '');
        if (t) {
          setPendingInviteUrl(t);
          router.push(`/invite/${t}` as any);
          return;
        }
      }
      if (parsed.hostname === 'shifts' && parsed.path) {
        const s = parsed.path.replace(/^\//, '');
        if (s) {
          router.push(`/shifts/${s}` as any);
          return;
        }
      }
      if (parsed.hostname === 'swaps' && parsed.path) {
        const w = parsed.path.replace(/^\//, '');
        if (w) {
          router.push(`/swaps/${w}` as any);
          return;
        }
      }
      if (parsed.hostname === 'calendar') {
        router.push('/calendar' as any);
        return;
      }
      if (parsed.hostname === 'billing') {
        router.push('/billing' as any);
        return;
      }
    } catch {
      // Ignore parsing errors
    }
  }, [router, setPendingInviteUrl]);

  useEffect(() => {
    // PRD 15.1: Background refresh on app start if refresh token exists
    bootstrapAuth().catch(() => {
      setStatus('unauthenticated');
    });

    // Register push notifications on open
    registerForPushNotificationsAsync().catch(() => {});

    // Notification tap handler (PRD 12.6, PART 3)
    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as
        | { url?: string; teamId?: string }
        | undefined;
      if (!data?.url) return;

      const currentAuth = useAuthStore.getState();
      if (currentAuth.status !== 'authenticated') {
        setPendingUrl(data.url);
        return;
      }

      if (data.teamId && data.teamId !== useTeamStore.getState().activeTeamId) {
        setActiveTeam(data.teamId);
      }

      handleDeepLink(data.url);
    };

    // Cold-start notification check (PRD 12.6)
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationResponse(response);
      }
    });

    // Foreground notification listener - refresh affected queries (PART 3.4)
    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      queryClient.invalidateQueries({ queryKey: ['me', 'shifts', 'upcoming'] });
      const currTeamId = useTeamStore.getState().activeTeamId;
      if (currTeamId) {
        queryClient.invalidateQueries({ queryKey: ['team', currTeamId, 'shifts'] });
        queryClient.invalidateQueries({ queryKey: ['team', currTeamId, 'swaps'] });
        queryClient.invalidateQueries({ queryKey: ['team', currTeamId, 'activity'] });
        queryClient.invalidateQueries({ queryKey: ['team', currTeamId, 'billing'] });
      }
    });

    // Response tap listener
    const responseSub =
      Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    Linking.getInitialURL().then(handleDeepLink);
    const linkingSub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));

    return () => {
      receivedSub.remove();
      responseSub.remove();
      linkingSub.remove();
    };
  }, [setStatus, handleDeepLink, setPendingUrl, setActiveTeam]);

  // After authentication, register device token and check pendingUrl
  useEffect(() => {
    if (authStatus === 'authenticated') {
      registerForPushNotificationsAsync().catch(() => {});
      const pendingUrl = useTeamStore.getState().pendingUrl;
      if (pendingUrl) {
        setPendingUrl(null);
        handleDeepLink(pendingUrl);
      }
    }
  }, [authStatus, handleDeepLink, setPendingUrl]);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="register" />
        <Stack.Screen name="login" />
        <Stack.Screen name="create-clinic" />
        <Stack.Screen name="home" />
        <Stack.Screen name="calendar" />
        <Stack.Screen name="my-shifts" />
        <Stack.Screen name="swaps" />
        <Stack.Screen name="team" />
        <Stack.Screen name="activity" />
        <Stack.Screen name="shifts/[id]" />
        <Stack.Screen name="shifts/new" />
        <Stack.Screen name="shifts/edit" />
        <Stack.Screen name="shifts/publish" />
        <Stack.Screen name="swaps/new" />
        <Stack.Screen name="swaps/[id]" />
        <Stack.Screen name="invite/index" />
        <Stack.Screen name="invite/[token]" />
        <Stack.Screen name="billing/index" />
        <Stack.Screen name="billing/change-plan" />
      </Stack>
    </QueryClientProvider>
  );
}
