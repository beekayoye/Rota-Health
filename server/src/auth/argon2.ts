import argon2 from 'argon2';

// PRD 6.1: argon2id (memory 19 MiB = 19456 KiB, iterations 2, parallelism 1)
export const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // 19456 KiB
  timeCost: 2, // 2 iterations
  parallelism: 1,
};

// Pre-computed dummy hash to ensure constant-time verification for unknown emails (PRD 6.1)
let dummyHash: string;

export async function initArgon2(): Promise<void> {
  if (!dummyHash) {
    dummyHash = await argon2.hash('__rota_health_dummy_password_timing_defense__', ARGON2_OPTIONS);
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    // Unknown email defense: verify against dummy hash
    if (!dummyHash) {
      await initArgon2();
    }
    await argon2.verify(dummyHash, password).catch(() => false);
    return false;
  }

  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
