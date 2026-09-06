import { defineConfig } from 'vitest/config';

// Unit-Tests ohne Datenbank (kein Testcontainers/Docker nötig): `npm run test:unit`
export default defineConfig({
  test: {
    include: ['test/**/*.unit.test.ts'],
    testTimeout: 30_000,
  },
});
