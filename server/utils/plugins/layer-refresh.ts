import { readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type PluginLayerRefreshMode =
  | 'not-required'
  | 'dev-reload-triggered'
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

async function touchNuxtConfigForDevRestart(rootDir: string): Promise<boolean> {
  const nuxtConfigPath = resolve(rootDir, 'nuxt.config.ts');

  try {
    const before = await stat(nuxtConfigPath);
    const bumpedMs = Math.max(Date.now(), Math.ceil(before.mtimeMs) + 1000);
    const touchedAt = new Date(bumpedMs);
    await utimes(nuxtConfigPath, touchedAt, touchedAt);

    const after = await stat(nuxtConfigPath);
    if (after.mtimeMs <= before.mtimeMs) {
      // Fallback for environments where mtime updates are coalesced.
      const current = await readFile(nuxtConfigPath, 'utf8');
      await writeFile(nuxtConfigPath, current, 'utf8');
    }
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
      message:
        process.env.NODE_ENV === 'production'
          ? 'Plugin installed. Rebuild and restart the panel process to apply Nuxt plugin runtime changes.'
          : 'Plugin installed. Restart the panel process to apply Nuxt plugin runtime changes.',
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

    return {
      mode: 'manual',
      automated: false,
      message: 'Plugin installed. Restart the panel process to apply Nuxt plugin runtime changes.',
    };
  }

  return {
    mode: 'manual',
    automated: false,
    message: 'Plugin installed. Rebuild and restart the panel process to apply Nuxt plugin runtime changes.',
  };
}
