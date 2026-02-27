import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { PoolClient } from 'pg';
import type { ResolvedPluginManifest } from '#shared/plugins/types';
import { usePool } from '#server/utils/drizzle';

const MIGRATION_TRACKING_TABLE = 'public.xyra_plugin_migrations';
const DEFAULT_CONNECT_RETRY_ATTEMPTS = 3;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 250;

export interface PluginMigrationApplyResult {
  total: number;
  applied: number;
  skipped: number;
}

export interface PluginMigrationRollbackResult {
  tracked: number;
  reverted: number;
  skipped: number;
  warnings: string[];
}

export class PluginMigrationError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'PluginMigrationError';
    this.statusCode = statusCode;
  }
}

interface TrackedPluginMigrationRow {
  migration_path: string;
  checksum: string;
  applied_at: string | Date | null;
}

function parseNonNegativeIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function shouldRetryPoolConnect(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
  };
  if (candidate.code === '53300') {
    return true;
  }

  if (typeof candidate.message !== 'string') {
    return false;
  }

  return candidate.message.toLowerCase().includes('too many clients');
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function acquireMigrationClientWithRetry(): Promise<PoolClient> {
  const pool = usePool();
  const retries = parseNonNegativeIntegerEnv(
    process.env.XYRA_PLUGIN_MIGRATION_CONNECT_RETRIES,
    DEFAULT_CONNECT_RETRY_ATTEMPTS,
  );
  const baseDelayMs = parseNonNegativeIntegerEnv(
    process.env.XYRA_PLUGIN_MIGRATION_CONNECT_RETRY_DELAY_MS,
    DEFAULT_CONNECT_RETRY_DELAY_MS,
  );

  let attempt = 0;
  // retries=3 means up to 4 total attempts: initial + 3 retries.
  while (attempt <= retries) {
    try {
      return await pool.connect();
    } catch (error) {
      if (!shouldRetryPoolConnect(error) || attempt >= retries) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.max(1, attempt + 1);
      await wait(delayMs);
      attempt += 1;
    }
  }

  throw new Error('Failed to acquire plugin migration database connection.');
}

function normalizeMigrationPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function checksumSqlContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function collectSqlFiles(migrationsRoot: string): Promise<string[]> {
  const rootStats = await stat(migrationsRoot).catch(() => null);
  if (!rootStats || !rootStats.isDirectory()) {
    throw new Error(`Migration directory does not exist or is not a directory: ${migrationsRoot}`);
  }

  const queue: string[] = [migrationsRoot];
  const sqlFiles: string[] = [];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name);

      if (entry.isSymbolicLink()) {
        throw new Error(`Migration directory cannot include symlinks: ${entryPath}`);
      }

      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const normalizedName = entry.name.toLowerCase();
      if (normalizedName.endsWith('.sql') && !normalizedName.endsWith('.down.sql')) {
        sqlFiles.push(entryPath);
      }
    }
  }

  sqlFiles.sort((left, right) => {
    const leftRel = normalizeMigrationPath(relative(migrationsRoot, left));
    const rightRel = normalizeMigrationPath(relative(migrationsRoot, right));
    return leftRel.localeCompare(rightRel);
  });

  return sqlFiles;
}

async function ensureTrackingTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TRACKING_TABLE} (
      plugin_id TEXT NOT NULL,
      migration_path TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (plugin_id, migration_path)
    )
  `);
}

function resolveMigrationAbsolutePath(migrationsRoot: string, migrationPath: string): string {
  const normalizedPath = normalizeMigrationPath(migrationPath.trim()).replace(/^\/+/, '');
  if (!normalizedPath || normalizedPath.includes('\0')) {
    throw new PluginMigrationError(422, `Invalid migration path "${migrationPath}".`);
  }

  const resolvedPath = resolve(migrationsRoot, normalizedPath);
  const relPath = relative(migrationsRoot, resolvedPath);
  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new PluginMigrationError(
      422,
      `Migration path "${migrationPath}" escapes plugin migration directory.`,
    );
  }

  return resolvedPath;
}

function resolveRollbackFilePath(migrationsRoot: string, migrationPath: string): string {
  if (!migrationPath.toLowerCase().endsWith('.sql')) {
    throw new PluginMigrationError(
      422,
      `Tracked migration "${migrationPath}" is not a .sql file and cannot be rolled back.`,
    );
  }

  const rollbackPath = migrationPath.replace(/\.sql$/i, '.down.sql');
  return resolveMigrationAbsolutePath(migrationsRoot, rollbackPath);
}

async function loadTrackedPluginMigrations(
  client: PoolClient,
  pluginId: string,
): Promise<TrackedPluginMigrationRow[]> {
  const result = await client.query<TrackedPluginMigrationRow>(
    `SELECT migration_path, checksum, applied_at
       FROM ${MIGRATION_TRACKING_TABLE}
      WHERE plugin_id = $1
      ORDER BY applied_at DESC, migration_path DESC`,
    [pluginId],
  );

  return result.rows;
}

async function applySqlMigrationFile(
  client: PoolClient,
  options: {
    pluginId: string;
    migrationPath: string;
    sqlContent: string;
    checksum: string;
  },
): Promise<'applied' | 'skipped'> {
  const existing = await client.query<{ checksum: string }>(
    `SELECT checksum
       FROM ${MIGRATION_TRACKING_TABLE}
      WHERE plugin_id = $1
        AND migration_path = $2`,
    [options.pluginId, options.migrationPath],
  );

  const existingChecksum = existing.rows[0]?.checksum;
  if (existingChecksum) {
    if (existingChecksum === options.checksum) {
      return 'skipped';
    }

    throw new Error(
      `Migration checksum mismatch for "${options.migrationPath}". Create a new migration file instead of editing an applied one.`,
    );
  }

  await client.query('BEGIN');
  try {
    if (options.sqlContent.trim().length > 0) {
      await client.query(options.sqlContent);
    }

    await client.query(
      `INSERT INTO ${MIGRATION_TRACKING_TABLE} (plugin_id, migration_path, checksum)
       VALUES ($1, $2, $3)`,
      [options.pluginId, options.migrationPath, options.checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return 'applied';
}

export async function applyPluginSqlMigrations(
  plugin: Pick<ResolvedPluginManifest, 'id' | 'migrationsPath'>,
): Promise<PluginMigrationApplyResult> {
  if (!plugin.migrationsPath) {
    return { total: 0, applied: 0, skipped: 0 };
  }

  const sqlFiles = await collectSqlFiles(plugin.migrationsPath);
  if (sqlFiles.length === 0) {
    return { total: 0, applied: 0, skipped: 0 };
  }

  const client = await acquireMigrationClientWithRetry();
  const lockKey = `xyra-plugin-migrations:${plugin.id}`;

  let applied = 0;
  let skipped = 0;

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
    await ensureTrackingTable(client);

    for (const sqlFile of sqlFiles) {
      const migrationPath = normalizeMigrationPath(relative(plugin.migrationsPath, sqlFile));
      const sqlContent = await readFile(sqlFile, 'utf8');
      const checksum = checksumSqlContent(sqlContent);

      const status = await applySqlMigrationFile(client, {
        pluginId: plugin.id,
        migrationPath,
        sqlContent,
        checksum,
      });

      if (status === 'applied') {
        applied += 1;
      } else {
        skipped += 1;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
    client.release();
  }

  return {
    total: sqlFiles.length,
    applied,
    skipped,
  };
}

export async function rollbackPluginSqlMigrations(
  plugin: Pick<ResolvedPluginManifest, 'id' | 'migrationsPath'>,
): Promise<PluginMigrationRollbackResult> {
  const client = await acquireMigrationClientWithRetry();
  const lockKey = `xyra-plugin-migrations:${plugin.id}`;

  let reverted = 0;
  let skipped = 0;
  const warnings: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
    await ensureTrackingTable(client);

    const trackedMigrations = await loadTrackedPluginMigrations(client, plugin.id);
    if (trackedMigrations.length === 0) {
      return {
        tracked: 0,
        reverted: 0,
        skipped: 0,
        warnings,
      };
    }

    if (!plugin.migrationsPath) {
      const warningMessage =
        `Plugin "${plugin.id}" has tracked migrations but no migrations directory is available for rollback. ` +
        'Database entries created by plugin migrations were not removed.';
      warnings.push(warningMessage);

      return {
        tracked: trackedMigrations.length,
        reverted,
        skipped: trackedMigrations.length,
        warnings,
      };
    }

    for (const migration of trackedMigrations) {
      let rollbackFilePath: string;
      try {
        rollbackFilePath = resolveRollbackFilePath(plugin.migrationsPath, migration.migration_path);
      } catch (error) {
        const warningMessage =
          `Unable to resolve rollback migration for "${migration.migration_path}": ${
            error instanceof Error ? error.message : String(error)
          } Database entries created by this migration were not removed.`;
        warnings.push(warningMessage);
        skipped += 1;
        continue;
      }

      const rollbackFileStats = await stat(rollbackFilePath).catch(() => null);
      if (!rollbackFileStats || !rollbackFileStats.isFile()) {
        warnings.push(
          `Missing rollback migration file for "${migration.migration_path}". Expected "${relative(plugin.migrationsPath, rollbackFilePath)}". ` +
            'Database entries created by this migration were not removed.',
        );
        skipped += 1;
        continue;
      }

      const rollbackSql = await readFile(rollbackFilePath, 'utf8');

      await client.query('BEGIN');
      try {
        if (rollbackSql.trim().length > 0) {
          await client.query(rollbackSql);
        }

        await client.query(
          `DELETE FROM ${MIGRATION_TRACKING_TABLE}
            WHERE plugin_id = $1
              AND migration_path = $2
              AND checksum = $3`,
          [plugin.id, migration.migration_path, migration.checksum],
        );

        await client.query('COMMIT');
        reverted += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return {
      tracked: trackedMigrations.length,
      reverted,
      skipped,
      warnings,
    };
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
    client.release();
  }
}
