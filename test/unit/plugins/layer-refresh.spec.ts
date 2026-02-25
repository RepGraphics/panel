import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyPluginLayerRefresh,
  type PluginLayerRefreshEventLike,
} from '../../../server/utils/plugins/layer-refresh';

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalNodeEnv = process.env.NODE_ENV;
const originalAutoRestartEnv = process.env.XYRA_PLUGIN_AUTO_RESTART;

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'xyra-plugin-layer-refresh-'));
  tempDirs.push(root);
  return root;
}

function createEventStub(): PluginLayerRefreshEventLike {
  const listeners = new Map<string, Array<() => void>>();

  return {
    node: {
      res: {
        writableEnded: false,
        writableFinished: false,
        once(eventName: string, listener: () => void) {
          const next = listeners.get(eventName) ?? [];
          next.push(listener);
          listeners.set(eventName, next);
          return this;
        },
      },
    },
  };
}

afterEach(() => {
  process.chdir(originalCwd);
  process.env.NODE_ENV = originalNodeEnv;
  process.env.XYRA_PLUGIN_AUTO_RESTART = originalAutoRestartEnv;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('server/utils/plugins/layer-refresh', () => {
  it('returns not-required when restart is not needed', async () => {
    const result = await applyPluginLayerRefresh({
      event: createEventStub(),
      restartRequired: false,
    });

    expect(result.mode).toBe('not-required');
    expect(result.automated).toBe(false);
  });

  it('returns manual when auto restart is disabled', async () => {
    const result = await applyPluginLayerRefresh({
      event: createEventStub(),
      restartRequired: true,
      autoRestart: false,
    });

    expect(result.mode).toBe('manual');
    expect(result.automated).toBe(false);
  });

  it('triggers Nuxt dev reload when running in development', async () => {
    const root = createTempRoot();
    writeFileSync(join(root, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n', 'utf8');

    process.chdir(root);
    process.env.NODE_ENV = 'development';
    process.env.XYRA_PLUGIN_AUTO_RESTART = 'false';

    const result = await applyPluginLayerRefresh({
      event: createEventStub(),
      restartRequired: true,
      autoRestart: true,
    });

    expect(result.mode).toBe('dev-reload-triggered');
    expect(result.automated).toBe(true);
  });

  it('schedules process restart when explicitly enabled in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.XYRA_PLUGIN_AUTO_RESTART = 'true';

    const result = await applyPluginLayerRefresh({
      event: createEventStub(),
      restartRequired: true,
      autoRestart: true,
    });

    expect(result.mode).toBe('process-restart-scheduled');
    expect(result.automated).toBe(true);
  });
});
