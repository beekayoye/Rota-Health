import * as SecureStore from 'expo-secure-store';

const KEY_DEVICE_ID = 'rh.deviceId';
const KEY_REFRESH_TOKEN = 'rh.refresh';

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Retrieves the deviceId, creating and storing a new UUID on first launch (PRD 15.1)
 */
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    let deviceId = await SecureStore.getItemAsync(KEY_DEVICE_ID);
    if (!deviceId) {
      deviceId = generateUUID();
      await SecureStore.setItemAsync(KEY_DEVICE_ID, deviceId);
    }
    return deviceId;
  } catch {
    return generateUUID();
  }
}

/**
 * Stores the rotating refresh token in expo-secure-store (PRD 14, 15.1)
 */
export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_REFRESH_TOKEN, token);
}

/**
 * Gets the stored refresh token from expo-secure-store
 */
export async function getStoredRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_REFRESH_TOKEN);
  } catch {
    return null;
  }
}

/**
 * Clears every secure store key except rh.deviceId on logout (PRD 14, prompt #5)
 */
export async function clearSecureStoreExceptDeviceId(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN);
  } catch {
    // Ignore error if already deleted
  }
}
