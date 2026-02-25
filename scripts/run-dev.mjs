import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function withDefault(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function buildDatabaseUrl(env) {
  const dbUser = withDefault(env.DB_USER, 'xyra');
  const dbPassword = withDefault(env.DB_PASSWORD, 'changeme');
  const dbPort = withDefault(env.DB_PORT, '5432');
  const dbName = withDefault(env.DB_NAME, 'xyrapanel');
  return `postgresql://${dbUser}:${dbPassword}@localhost:${dbPort}/${dbName}`;
}

const args = process.argv.slice(2);
const isLanMode = args.includes('--lan');
const passthroughArgs = args.filter((arg) => arg !== '--lan');

const env = { ...process.env };
env.DATABASE_URL = withDefault(env.DATABASE_URL, buildDatabaseUrl(env));
env.REDIS_HOST = withDefault(env.REDIS_HOST, 'localhost');
env.NITRO_STORAGE_CACHE_HOST = withDefault(env.NITRO_STORAGE_CACHE_HOST, 'localhost');
env.NUXT_REDIS_HOST = withDefault(env.NUXT_REDIS_HOST, 'localhost');

const nuxtArgs = ['dev', ...passthroughArgs];

if (isLanMode) {
  nuxtArgs.push('--host', '0.0.0.0', '--port', withDefault(env.PORT, '3000'));
}

const nuxtBinPath = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url));

const child = spawn(process.execPath, [nuxtBinPath, ...nuxtArgs], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('[run-dev] Failed to start Nuxt:', error);
  process.exit(1);
});
