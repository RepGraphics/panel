import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type PluginLayerRefreshMode =
  | 'not-required'
  | 'dev-reload-triggered'
  | 'process-restart-scheduled'
  | 'manual';

export interface PluginLayerRefreshResult {
  mode: PluginLayerRefreshMode;
  automated: boolean;
  message: string;
}

export interface PluginLayerRefreshEventLike {
  node: {
    res: {
      writableEnded: boolean;
      writableFinished: boolean;
      once: (eventName: string, listener: () => void) => unknown;
    };
  };
}

interface ApplyPluginLayerRefreshOptions {
  event: PluginLayerRefreshEventLike;
  restartRequired: boolean;
  autoRestart?: boolean;
}

const PROCESS_MANAGER_HINTS = [
  'PM2_HOME',
  'NODE_APP_INSTANCE',
  'KUBERNETES_SERVICE_HOST',
  'CONTAINER',
  'DOCKER_CONTAINER',
  'INVOCATION_ID',
] as const;

const DEFAULT_RESTART_DELAY_MS = 1500;

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseRestartDelayMs(value: string | undefined): number {
  if (!value) return DEFAULT_RESTART_DELAY_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_RESTART_DELAY_MS;
  }

  return parsed;
}

function isManagedProcessLikely(): boolean {
  return PROCESS_MANAGER_HINTS.some((name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

async function touchNuxtConfigForDevRestart(rootDir: string): Promise<boolean> {
  const nuxtConfigPath = resolve(rootDir, 'nuxt.config.ts');

  try {
    const current = await readFile(nuxtConfigPath, 'utf8');
    await writeFile(nuxtConfigPath, current, 'utf8');
    return true;
  } catch (error) {
    console.warn(
      `[plugins] Failed to trigger Nuxt dev reload via nuxt.config.ts touch: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

function scheduleProcessRestartAfterResponse(event: PluginLayerRefreshEventLike): boolean {
  const delayMs = parseRestartDelayMs(process.env.XYRA_PLUGIN_RESTART_DELAY_MS);
  const response = event.node.res;
  let scheduled = false;

  const queueRestart = (): void => {
    if (scheduled) return;
    scheduled = true;

    setTimeout(() => {
      console.warn('[plugins] Restarting panel process to apply plugin Nuxt runtime changes.');

      if (process.platform === 'win32') {
        process.exit(0);
        return;
      }

      process.kill(process.pid, 'SIGTERM');
    }, delayMs).unref();
  };

  if (response.writableEnded || response.writableFinished) {
    queueRestart();
    return true;
  }

  response.once('finish', queueRestart);
  response.once('close', queueRestart);
  return true;
}

export async function applyPluginLayerRefresh(
  options: ApplyPluginLayerRefreshOptions,
): Promise<PluginLayerRefreshResult> {
  if (!options.restartRequired) {
    return {
      mode: 'not-required',
      automated: false,
      message: 'Plugin installed successfully.',
    };
  }

  const autoRestart = options.autoRestart ?? true;
  if (!autoRestart) {
    return {
      mode: 'manual',
      automated: false,
      message: 'Plugin installed. Restart the panel process to apply Nuxt plugin runtime changes.',
    };
  }

  if (process.env.NODE_ENV !== 'production') {
    const triggered = await touchNuxtConfigForDevRestart(process.cwd());
    if (triggered) {
      return {
        mode: 'dev-reload-triggered',
        automated: true,
        message: 'Plugin installed. Triggered a Nuxt dev reload to apply plugin runtime changes.',
      };
    }
  }

  const allowProcessRestart = parseBooleanEnv(process.env.XYRA_PLUGIN_AUTO_RESTART);
  if (!allowProcessRestart && !isManagedProcessLikely()) {
    return {
      mode: 'manual',
      automated: false,
      message:
        'Plugin installed. Restart the panel process to apply Nuxt plugin runtime changes (or set XYRA_PLUGIN_AUTO_RESTART=true).',
    };
  }

  scheduleProcessRestartAfterResponse(options.event);
  return {
    mode: 'process-restart-scheduled',
    automated: true,
    message: 'Plugin installed. Panel restart has been scheduled to apply Nuxt plugin runtime changes.',
  };
}
