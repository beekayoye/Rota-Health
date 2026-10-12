import { execSync } from 'node:child_process';
import path from 'node:path';

try {
  console.log('Running prisma migrate deploy...');
  const output = execSync('npx prisma migrate deploy --schema=./prisma/schema.prisma', {
    cwd: path.resolve('server'),
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://postgres:postgrespassword@localhost:5435/rota_test',
      DIRECT_URL: 'postgresql://postgres:postgrespassword@localhost:5435/rota_test',
    },
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  console.log('Output:\n', output);
} catch (err: any) {
  console.error('Migration failed!');
  console.error('Stdout:', err.stdout);
  console.error('Stderr:', err.stderr);
  console.error('Message:', err.message);
}
