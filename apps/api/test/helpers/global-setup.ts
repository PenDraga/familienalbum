import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Startet einmal pro Testlauf eine PostgreSQL-Instanz (Testcontainers) und spielt die Migrationen ein.
 * Mit TEST_DATABASE_URL wird stattdessen eine bestehende Datenbank verwendet (z.B. in CI ohne Docker-in-Docker).
 * Achtung: Die Tests leeren alle Tabellen dieser Datenbank.
 */
export default async function setup(project: TestProject) {
  let databaseUrl = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<unknown>) | undefined;

  if (!databaseUrl) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('familienalbum_test')
      .withUsername('test')
      .withPassword('test')
      .start();
    databaseUrl = container.getConnectionUri();
    stop = () => container.stop();
  }

  execSync('npx prisma migrate deploy', {
    cwd: apiRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await stop?.();
  };
}
