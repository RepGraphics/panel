import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeMigrationState: {
  rows: Array<{
    plugin_id: string;
    migration_path: string;
    checksum: string;
    applied_at: string;
  }>;
  executedSql: string[];
  counter: number;
  connectErrors: unknown[];
  connectCalls: number;
} = {
  rows: [],
  executedSql: [],
  counter: 0,
  connectErrors: [],
  connectCalls: 0,
};

vi.mock('#server/utils/drizzle', () => ({
  usePool: () => ({
    connect: async () => {
      fakeMigrationState.connectCalls += 1;
      if (fakeMigrationState.connectErrors.length > 0) {
        throw fakeMigrationState.connectErrors.shift();
      }

      return {
        query: async (statement: string, params?: unknown[]) => {
          const sql = statement.trim();
          const normalized = sql.toLowerCase();

          if (
            normalized.startsWith('select pg_advisory_lock') ||
            normalized.startsWith('select pg_advisory_unlock') ||
            normalized.startsWith('create table if not exists public.xyra_plugin_migrations') ||
            normalized === 'begin' ||
            normalized === 'commit' ||
            normalized === 'rollback'
          ) {
            return { rows: [] };
          }

          if (normalized.startsWith('select checksum')) {
            const pluginId = String(params?.[0] ?? '');
            const migrationPath = String(params?.[1] ?? '');
            const row = fakeMigrationState.rows.find(
              (entry) => entry.plugin_id === pluginId && entry.migration_path === migrationPath,
            );
            return { rows: row ? [{ checksum: row.checksum }] : [] };
          }

          if (normalized.startsWith('select migration_path, checksum, applied_at')) {
            const pluginId = String(params?.[0] ?? '');
            const rows = fakeMigrationState.rows
              .filter((entry) => entry.plugin_id === pluginId)
              .sort((left, right) => {
                const timeDiff =
                  new Date(right.applied_at).getTime() - new Date(left.applied_at).getTime();
                if (timeDiff !== 0) {
                  return timeDiff;
                }

                return right.migration_path.localeCompare(left.migration_path);
              })
              .map((entry) => ({
                migration_path: entry.migration_path,
                checksum: entry.checksum,
                applied_at: entry.applied_at,
              }));
            return { rows };
          }

          if (normalized.startsWith('insert into public.xyra_plugin_migrations')) {
            const pluginId = String(params?.[0] ?? '');
            const migrationPath = String(params?.[1] ?? '');
            const checksum = String(params?.[2] ?? '');

            fakeMigrationState.counter += 1;
            fakeMigrationState.rows.push({
              plugin_id: pluginId,
              migration_path: migrationPath,
              checksum,
              applied_at: new Date(fakeMigrationState.counter * 1000).toISOString(),
            });
            return { rows: [] };
          }

          if (normalized.startsWith('delete from public.xyra_plugin_migrations')) {
            const pluginId = String(params?.[0] ?? '');
            const migrationPath = String(params?.[1] ?? '');
            const checksum = String(params?.[2] ?? '');
            fakeMigrationState.rows = fakeMigrationState.rows.filter(
              (entry) =>
                !(
                  entry.plugin_id === pluginId &&
                  entry.migration_path === migrationPath &&
                  entry.checksum === checksum
                ),
            );
            return { rows: [] };
          }

          fakeMigrationState.executedSql.push(sql);
          return { rows: [] };
        },
        release: () => undefined,
      };
    },
  }),
}));

import {
  applyPluginSqlMigrations,
  rollbackPluginSqlMigrations,
} from '../../../server/utils/plugins/migrations';

const tempDirs: string[] = [];

function createTempMigrationsDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'xyra-plugin-migrations-'));
  tempDirs.push(root);
  return root;
}

beforeEach(() => {
  fakeMigrationState.rows = [];
  fakeMigrationState.executedSql = [];
  fakeMigrationState.counter = 0;
  fakeMigrationState.connectErrors = [];
  fakeMigrationState.connectCalls = 0;
  delete process.env.XYRA_PLUGIN_MIGRATION_CONNECT_RETRIES;
  delete process.env.XYRA_PLUGIN_MIGRATION_CONNECT_RETRY_DELAY_MS;
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }

    rmSync(dir, { recursive: true, force: true });
  }
});

describe('server/utils/plugins/migrations', () => {
  it('applies only up migration files and skips .down.sql files', async () => {
    const migrationsRoot = createTempMigrationsDir();

    writeFileSync(join(migrationsRoot, '001_create.sql'), "SELECT 'up-1';", 'utf8');
    writeFileSync(join(migrationsRoot, '001_create.down.sql'), "SELECT 'down-1';", 'utf8');
    mkdirSync(join(migrationsRoot, 'nested'), { recursive: true });
    writeFileSync(join(migrationsRoot, 'nested', '002_seed.sql'), "SELECT 'up-2';", 'utf8');
    writeFileSync(
      join(migrationsRoot, 'nested', '002_seed.down.sql'),
      "SELECT 'down-2';",
      'utf8',
    );

    const result = await applyPluginSqlMigrations({
      id: 'acme-tools',
      migrationsPath: migrationsRoot,
    });

    expect(result.total).toBe(2);
    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(0);
    expect(fakeMigrationState.rows.map((entry) => entry.migration_path)).toEqual([
      '001_create.sql',
      'nested/002_seed.sql',
    ]);
  });

  it('rolls back tracked plugin migrations in reverse order', async () => {
    const migrationsRoot = createTempMigrationsDir();

    writeFileSync(join(migrationsRoot, '001_create.sql'), "SELECT 'up-1';", 'utf8');
    writeFileSync(join(migrationsRoot, '001_create.down.sql'), "SELECT 'down-1';", 'utf8');
    writeFileSync(join(migrationsRoot, '002_seed.sql'), "SELECT 'up-2';", 'utf8');
    writeFileSync(join(migrationsRoot, '002_seed.down.sql'), "SELECT 'down-2';", 'utf8');

    await applyPluginSqlMigrations({
      id: 'acme-tools',
      migrationsPath: migrationsRoot,
    });

    fakeMigrationState.executedSql = [];

    const rollbackResult = await rollbackPluginSqlMigrations({
      id: 'acme-tools',
      migrationsPath: migrationsRoot,
    });

    expect(rollbackResult).toEqual({ tracked: 2, reverted: 2, skipped: 0, warnings: [] });
    expect(fakeMigrationState.rows).toHaveLength(0);
    expect(fakeMigrationState.executedSql).toEqual(["SELECT 'down-2';", "SELECT 'down-1';"]);
  });

  it('warns and skips when a .down.sql rollback migration is missing', async () => {
    const migrationsRoot = createTempMigrationsDir();

    writeFileSync(join(migrationsRoot, '001_create.sql'), "SELECT 'up-1';", 'utf8');

    await applyPluginSqlMigrations({
      id: 'acme-tools',
      migrationsPath: migrationsRoot,
    });

    const rollbackResult = await rollbackPluginSqlMigrations({
      id: 'acme-tools',
      migrationsPath: migrationsRoot,
    });

    expect(rollbackResult.tracked).toBe(1);
    expect(rollbackResult.reverted).toBe(0);
    expect(rollbackResult.skipped).toBe(1);
    expect(rollbackResult.warnings).toHaveLength(1);
    expect(rollbackResult.warnings[0]?.toLowerCase()).toContain('missing rollback migration file');
    expect(fakeMigrationState.rows).toHaveLength(1);
  });

  it('retries migration database connection when postgres is temporarily saturated', async () => {
    process.env.XYRA_PLUGIN_MIGRATION_CONNECT_RETRIES = '2';
    process.env.XYRA_PLUGIN_MIGRATION_CONNECT_RETRY_DELAY_MS = '0';

    const migrationsRoot = createTempMigrationsDir();
    writeFileSync(join(migrationsRoot, '001_create.sql'), "SELECT 'up-1';", 'utf8');

    fakeMigrationState.connectErrors.push(
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
    );

    const result = await applyPluginSqlMigrations({
      id: 'acme-tools',
      migrationsPath: migrationsRoot,
    });

    expect(result.applied).toBe(1);
    expect(fakeMigrationState.connectCalls).toBe(3);
  });

  it('fails after configured migration database connection retries are exhausted', async () => {
    process.env.XYRA_PLUGIN_MIGRATION_CONNECT_RETRIES = '1';
    process.env.XYRA_PLUGIN_MIGRATION_CONNECT_RETRY_DELAY_MS = '0';

    const migrationsRoot = createTempMigrationsDir();
    writeFileSync(join(migrationsRoot, '001_create.sql'), "SELECT 'up-1';", 'utf8');

    fakeMigrationState.connectErrors.push(
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
    );

    await expect(
      applyPluginSqlMigrations({
        id: 'acme-tools',
        migrationsPath: migrationsRoot,
      }),
    ).rejects.toThrow('too many clients');

    expect(fakeMigrationState.connectCalls).toBe(2);
  });
});
