# Authentication, Token Lifecycle, and Client Security Rules

These rules govern user authentication, token lifecycles, refresh rotation, auth link binding, secure storage, and client bundle integrity.

## 1. Token Architecture and Lifecycles (PRD 14, 15.1)
- Access tokens:
  - Formatted as JWT (HS256 signed with `JWT_SECRET`), expiring in 15 minutes (`exp = iat + 900`).
  - Standard claims: `sub` (user ID), `sid` (session/family ID), `tv` (token version), `iat`, `exp`.
  - Never store tenant ID or user roles inside the JWT payload. Roles and memberships must be resolved dynamically from the database on each request (PRD 6.2, 15.1).
  - Storage: In-memory only (Zustand client state). Never persist access tokens to disk, AsyncStorage, or MMKV.
- Refresh tokens:
  - Generated as 32 cryptographically secure random bytes (base64url).
  - The server stores only `SHA-256(token)` alongside `familyId`, `deviceId`, and `expiresAt` (30 days).
  - Storage: Stored exclusively in `expo-secure-store` on the device (backed by Android Keystore). Never store in AsyncStorage or MMKV.

## 2. Refresh Rotation and Reuse Detection (PRD 15.2)
- Refresh endpoint: `POST /v1/auth/refresh { refreshToken, deviceId }`.
- On every valid refresh call, the server must mark the old token `usedAt = now()`, generate a new refresh token within the same token family, and return a new access/refresh token pair.
- Reuse detection:
  - If a refresh token is presented whose `usedAt` or `revokedAt` is already set, the server must immediately revoke all tokens belonging to that `familyId`.
  - Log `auth.refresh_reused` with user ID and client IP, and return 401 `REFRESH_REUSED`.
- The client must maintain a single shared refresh promise to prevent concurrent refresh requests from colliding.
- Log out of all devices (`POST /v1/auth/logout-all`):
  - Revoke all refresh tokens for the user, increment `users.token_version`, delete Redis key `auth:tv:{userId}`, and delete all registered device tokens.

## 3. Auth Link Binding for Magic Links and Password Resets (PRD 15.3)
- Because Android apps can register custom URI schemes (`rotahealth://`), an emailed token alone is insufficient for authentication.
- Requesting an auth link:
  - The mobile app must generate a cryptographically random 32-byte `codeVerifier`.
  - Store `codeVerifier` temporarily in `expo-secure-store`.
  - Transmit `codeChallenge = base64url(SHA-256(codeVerifier))` along with `deviceId` to the server.
  - The server persists `codeChallenge` and `deviceId` alongside the hashed link token in `auth_tokens`.
- Redeeming an auth link:
  - The mobile client must submit the token, `deviceId`, and the plaintext `codeVerifier`.
  - The server verifies that the token, device ID, and SHA-256 challenge hash match before completing the login or password reset.
  - If the verifier or device does not match, return 410 `TOKEN_INVALID`.
  - Delete `rh.codeVerifier` from `expo-secure-store` immediately after consumption.

## 4. Client Bundle Secret Isolation (PRD 15.4)
- The mobile application bundle must never contain server secrets, database credentials, or provider private keys.
- Only the four approved `EXPO_PUBLIC_` environment variables may exist in the mobile client:
  1. `EXPO_PUBLIC_API_URL`
  2. `EXPO_PUBLIC_SENTRY_DSN`
  3. `EXPO_PUBLIC_APP_ENV`
  4. `EXPO_PUBLIC_EAS_PROJECT_ID`
- CI must enforce this boundary using `scripts/check-bundle-secrets.sh`, scanning the exported Android bundle for sensitive secret patterns (`FLWSECK`, `postgres://`, `sk_`, and server key prefixes) and failing the build upon any detection.

## 5. Offline Storage and Cache Encryption (PRD 6.8, 14)
- Server query results cached offline must be stored in `react-native-mmkv` with AES encryption.
- The 32-byte random encryption key must be generated on first launch and stored in `expo-secure-store` (`rh.cacheKey`).
- Cache hydration restriction:
  - Only queries `["me"]`, `["me","settings"]`, and `["me","shifts","upcoming"]` are permitted to dehydrate into persistent storage.
  - All other queries (calendars, feed pages, billing, swap inboxes) remain in memory with standard garbage collection.
- On logout:
  - Clear `queryClient`, delete the MMKV database instance and its encryption key, reset Zustand stores, and purge all `expo-secure-store` keys except `rh.deviceId` (PRD 14).
