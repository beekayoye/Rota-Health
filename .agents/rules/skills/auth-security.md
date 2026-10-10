---
name: auth-security
description: Procedures for managing token lifecycles, executing refresh rotation with family reuse revocation, binding auth links using PKCE device verifiers, scanning bundles for leaked secrets, and managing encrypted MMKV storage.
---

# Skill: Authentication, Token Lifecycles, and Client Security

Use this skill when implementing login, registration, token refresh, logout, magic links, password resets, secure device storage, or mobile client offline cache hydration.

## 1. Token Lifecycles and Session Architecture (PRD 14, 15.1)

### Access Token Generation (Server)
```typescript
import jwt from 'jsonwebtoken';

export function createAccessToken(userId: string, familyId: string, tokenVersion: number): string {
  return jwt.sign(
    {
      sub: userId,
      sid: familyId,
      tv: tokenVersion,
    },
    process.env.JWT_SECRET!,
    {
      expiresIn: '15m',
      algorithm: 'HS256',
    }
  );
}
```
*Note: Never include roles or team IDs in access token claims. Read memberships from the database on every request.*

### Refresh Token Storage and Rotation (PRD 15.2)
1. **Generation:** Generate 32 bytes of cryptographically secure random data, encoded as `base64url`.
2. **Server Storage:** Store only `SHA-256(refreshToken)` in the `refresh_tokens` table on Shard A alongside `familyId`, `deviceId`, and `expiresAt` (30 days).
3. **Client Storage:** Store exclusively in `expo-secure-store` under key `rh.refresh`. Never persist to AsyncStorage or MMKV.

### Rotation Algorithm (`POST /v1/auth/refresh`)
```typescript
export async function rotateRefreshToken(oldToken: string, deviceId: string) {
  const tokenHash = crypto.createHash('sha256').update(oldToken).digest('hex');
  const record = await shardADb.refreshToken.findUnique({ where: { tokenHash } });

  if (!record || record.expiresAt < new Date()) {
    throw new UnauthorizedError('REFRESH_EXPIRED');
  }

  // Reuse Detection: If token was previously used or revoked
  if (record.usedAt !== null || record.revokedAt !== null) {
    // Revoke the ENTIRE token family immediately
    await shardADb.refreshToken.updateMany({
      where: { familyId: record.familyId },
      data: { revokedAt: new Date() },
    });
    logger.warn('auth.refresh_reused', { userId: record.userId, familyId: record.familyId });
    throw new UnauthorizedError('REFRESH_REUSED');
  }

  // Normal Rotation: Commit within transaction
  const newRawToken = crypto.randomBytes(32).toString('base64url');
  const newHash = crypto.createHash('sha256').update(newRawToken).digest('hex');

  const [_, newRecord, user] = await shardADb.$transaction([
    shardADb.refreshToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    shardADb.refreshToken.create({
      data: {
        userId: record.userId,
        familyId: record.familyId,
        deviceId,
        tokenHash: newHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    }),
    shardADb.user.findUniqueOrThrow({ where: { id: record.userId } }),
  ]);

  const newAccessToken = createAccessToken(user.id, record.familyId, user.tokenVersion);
  return { accessToken: newAccessToken, refreshToken: newRawToken };
}
```

### Axios Client Refresh Interceptor (Mobile App)
The client must prevent parallel 401s from issuing multiple refresh calls:
```typescript
let refreshPromise: Promise<string> | null = null;

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      if (!refreshPromise) {
        refreshPromise = performTokenRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccessToken = await refreshPromise;
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return apiClient(originalRequest);
    }
    return Promise.reject(error);
  }
);
```

---

## 2. Auth Link PKCE Binding (PRD 15.3)

### Request Phase (`POST /v1/auth/magic-link` or `POST /v1/auth/password/forgot`)
1. Mobile app creates 32-byte random `codeVerifier` and stores it in `expo-secure-store` under `rh.codeVerifier`.
2. Mobile app sends `codeChallenge = base64url(SHA-256(codeVerifier))` and its install `deviceId`.
3. Server saves `deviceId` and `codeChallenge` on the `auth_tokens` row.

### Verification Phase (`POST /v1/auth/magic-link/verify` or `POST /v1/auth/password/reset`)
1. App reads `rh.codeVerifier` from `expo-secure-store`.
2. App posts `token`, `deviceId`, and `codeVerifier`.
3. Server re-computes `base64url(SHA-256(codeVerifier))` and asserts:
   - Challenge matches stored challenge.
   - Request `deviceId` matches stored device.
   - Token is unexpired and unused.
4. If mismatch: reject with 410 `TOKEN_INVALID`.
5. On success: delete `rh.codeVerifier` from device secure store.

---

## 3. Client Bundle Secret Scan Verification (PRD 15.4)

Run the automated secret detection script before any build or PR merge:
```bash
bash scripts/check-bundle-secrets.sh
```
The script exports the Android JavaScript bundle and greps for:
- `FLWSECK` (Flutterwave secret keys).
- `postgres://` (Database connection strings).
- `sk_` (Stripe, Resend, or OpenAI keys).
- First 8 characters of all environment secrets.

---

## 4. Encrypted MMKV Offline Cache (PRD 6.8, 14)

### Initialization Pattern
```typescript
import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

export async function getEncryptedStorage(): Promise<MMKV> {
  let key = await SecureStore.getItemAsync('rh.cacheKey');
  if (!key) {
    key = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    await SecureStore.setItemAsync('rh.cacheKey', key);
  }
  return new MMKV({ id: 'rota-health-cache', encryptionKey: key });
}
```

### Dehydration Allowlist
Configure `persistQueryClient` with `shouldDehydrateQuery` allowing only:
- `["me"]`
- `["me", "settings"]`
- `["me", "shifts", "upcoming"]`
All other queries must remain ephemeral in memory.

### Logout Purge
On user logout:
```typescript
queryClient.clear();
mmkvInstance.clearAll();
await SecureStore.deleteItemAsync('rh.cacheKey');
await SecureStore.deleteItemAsync('rh.refresh');
// Note: Never delete rh.deviceId (must remain stable per device install)
```
