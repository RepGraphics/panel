import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, or, inArray, isNull, isNotNull, lt, desc } from 'drizzle-orm';
import * as schema from '#server/database/schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  // We don't throw immediately here to allow build/prepare steps to run if needed,
  // but we should warn in a real app.
}

let pgPool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseNonNegativeIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function getPgPool() {
  if (pgPool) {
    return pgPool;
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required for PostgreSQL connection.');
  }

  const poolMax = parsePositiveIntegerEnv(process.env.DATABASE_POOL_MAX, 5);
  const poolIdleTimeoutMs = parseNonNegativeIntegerEnv(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS, 30000);
  const poolConnectionTimeoutMs = parseNonNegativeIntegerEnv(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS, 2000);

  pgPool = new Pool({
    connectionString: databaseUrl,
    max: poolMax,
    idleTimeoutMillis: poolIdleTimeoutMs,
    connectionTimeoutMillis: poolConnectionTimeoutMs,
  });

  return pgPool;
}

export type DrizzleDatabase = NodePgDatabase<typeof schema>;

export function usePool(): Pool {
  return getPgPool();
}

export function useDrizzle(): DrizzleDatabase {
  if (!db) {
    db = drizzle(getPgPool(), { schema });
  }
  return db;
}

export const tables = schema.tables;

export { eq, and, or, inArray, isNull, isNotNull, lt, desc };
