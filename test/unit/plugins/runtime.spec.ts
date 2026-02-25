import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emitPluginHook,
  getPluginClientContributions,
  getPluginRuntimeSummary,
  initializePluginRuntime,
  resetPluginRuntimeStateForTests,
} from '../../../server/utils/plugins/runtime';

const tempDirs: string[] = [];
const originalPluginDirsEnv = process.env.XYRA_PLUGIN_DIRS;
const globalMarker = globalThis as typeof globalThis & {
  __xyraPluginSetupCount?: number;
  __xyraPluginPayloads?: unknown[];
};

function createPluginRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'xyra-plugin-runtime-'));
  tempDirs.push(root);
  return root;
}

beforeEach(() => {
  resetPluginRuntimeStateForTests();
  globalMarker.__xyraPluginSetupCount = 0;
  globalMarker.__xyraPluginPayloads = [];
});

afterEach(() => {
  resetPluginRuntimeStateForTests();
  process.env.XYRA_PLUGIN_DIRS = originalPluginDirsEnv;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('server/utils/plugins/runtime', () => {
  it('loads plugin server entries and executes hooks', async () => {
    const root = createPluginRoot();
    const pluginDir = join(root, 'acme-tools');

    mkdirSync(join(pluginDir, 'dist'), { recursive: true });

    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify(
        {
          id: 'acme-tools',
          name: 'Acme Tools',
          version: '1.0.0',
          entry: {
            server: './dist/server.mjs',
          },
          contributions: {
            dashboardNavigation: [
              {
                id: 'acme-tools-dashboard',
                label: 'Acme Tools',
                to: '/acme-tools',
              },
            ],
            serverNavigation: [
              {
                id: 'acme-tools-server',
                label: 'Acme Tools',
                to: 'acme-tools',
              },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(pluginDir, 'dist', 'server.mjs'),
      `
      export default {
        setup() {
          globalThis.__xyraPluginSetupCount = (globalThis.__xyraPluginSetupCount ?? 0) + 1;
        },
        hooks: {
          'test:event': async (payload) => {
            const entries = globalThis.__xyraPluginPayloads ?? [];
            entries.push(payload);
            globalThis.__xyraPluginPayloads = entries;
          },
        },
      };
      `,
      'utf8',
    );

    process.env.XYRA_PLUGIN_DIRS = root;

    const summary = await initializePluginRuntime({});
    const clientContributions = getPluginClientContributions();
    await emitPluginHook('test:event', { ok: true });

    expect(summary.plugins).toHaveLength(1);
    expect(summary.plugins[0]?.id).toBe('acme-tools');
    expect(summary.plugins[0]?.loaded).toBe(true);
    expect(summary.plugins[0]?.hooks).toContain('test:event');
    expect(clientContributions.serverNavigation).toEqual([
      {
        id: 'plugin:acme-tools:acme-tools-server',
        label: 'Acme Tools',
        to: 'acme-tools',
        pluginId: 'acme-tools',
        order: 500,
      },
    ]);
    expect(clientContributions.dashboardNavigation).toEqual([
      {
        id: 'plugin:acme-tools:acme-tools-dashboard',
        label: 'Acme Tools',
        to: '/acme-tools',
        pluginId: 'acme-tools',
        order: 500,
      },
    ]);
    expect(globalMarker.__xyraPluginSetupCount).toBe(1);
    expect(globalMarker.__xyraPluginPayloads).toEqual([{ ok: true }]);
  });

  it('records plugin errors when hook handlers throw', async () => {
    const root = createPluginRoot();
    const pluginDir = join(root, 'broken-hooks');

    mkdirSync(join(pluginDir, 'dist'), { recursive: true });

    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify(
        {
          id: 'broken-hooks',
          name: 'Broken Hooks',
          version: '1.0.0',
          entry: {
            server: './dist/server.mjs',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      join(pluginDir, 'dist', 'server.mjs'),
      `
      export default {
        hooks: {
          'test:failing': async () => {
            throw new Error('boom');
          },
        },
      };
      `,
      'utf8',
    );

    process.env.XYRA_PLUGIN_DIRS = root;

    await initializePluginRuntime({});
    await emitPluginHook('test:failing');

    const summary = getPluginRuntimeSummary();
    const plugin = summary.plugins.find((entry) => entry.id === 'broken-hooks');

    expect(plugin).toBeDefined();
    expect(plugin?.errors.some((error) => error.includes('Hook "test:failing" failed'))).toBe(true);
  });
});
