import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { PoolClient } from 'pg';
import type { ResolvedPluginManifest } from '#shared/plugins/types';
import { usePool } from '#server/utils/drizzle';

const MIGRATION_TRACKING_TABLE = 'public.xyra_plugin_migrations';

export interface PluginMigrationApplyResult {
  total: number;
  applied: number;
  skipped: number;
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

      if (entry.name.toLowerCase().endsWith('.sql')) {
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

  const pool = usePool();
  const client = await pool.connect();
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
