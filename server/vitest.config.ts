import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://postgres:postgrespassword@localhost:5435/rota_test',
      DIRECT_URL: 'postgresql://postgres:postgrespassword@localhost:5435/rota_test',
      REDIS_URL: 'redis://localhost:6380',
      JWT_SECRET: 'super_secret_test_key_at_least_32_bytes_long!',
      NODE_ENV: 'test',
    },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
