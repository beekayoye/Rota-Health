import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { apiClient } from '../api/client';
import { getOrCreateDeviceId } from '../storage/secure-store';

/**
 * Configure global notification presentation when received in foreground
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Registers device with backend (PRD 6.6, 12, 15.5):
 * 1. Creates Android notification channels: shifts, swaps, billing
 * 2. Asks for notification permission once
 * 3. Obtains Expo push token with EAS project ID
 * 4. Calls PUT /v1/me/devices/:deviceId
 * If permission is denied, silently returns without disrupting UX.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    // 1. Android Notification Channels (PRD 6.6, PART 3)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('shifts', {
        name: 'Shift Schedules',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#004ed4',
      });

      await Notifications.setNotificationChannelAsync('swaps', {
        name: 'Shift Swaps',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#004ed4',
      });

      await Notifications.setNotificationChannelAsync('billing', {
        name: 'Billing & Subscriptions',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#c51707',
      });
    }

    // 2. Request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      // User opted out; app continues working silently
      return null;
    }

    // 3. Obtain Expo Push Token using EAS Project ID
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const expoPushToken = tokenResponse.data;

    // 4. Register device token on server
    const deviceId = await getOrCreateDeviceId();
    await apiClient.put(`/me/devices/${deviceId}`, {
      expoPushToken,
      platform: 'android',
    });

    return expoPushToken;
  } catch {
    // Fail silently so network or permission failures never crash app boot
    return null;
  }
}
