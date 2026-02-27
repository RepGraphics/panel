import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PluginManagementError,
  setPluginManifestEnabledState,
} from '../../../server/utils/plugins/management';

const tempDirs: string[] = [];
const originalPluginDirsEnv = process.env.XYRA_PLUGIN_DIRS;
const originalPluginsDirEnv = process.env.XYRA_PLUGINS_DIR;
const pluginSystemVersion = (() => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    xyra?: { pluginSystemVersion?: string };
  };
  return pkg.xyra?.pluginSystemVersion ?? '0.1 Alpha';
})();

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'xyra-plugin-management-'));
  tempDirs.push(root);
  return root;
}

function writePluginManifest(path: string, enabled = true): void {
  writeFileSync(
    path,
    JSON.stringify(
      {
        id: 'acme-tools',
        name: 'Acme Tools',
        version: '1.0.0',
        compatibility: pluginSystemVersion,
        description: 'Plugin management fixture',
        author: 'Test Author',
        website: 'https://example.com',
        enabled,
      },
      null,
      2,
    ),
    'utf8',
  );
}

afterEach(() => {
  process.env.XYRA_PLUGIN_DIRS = originalPluginDirsEnv;
  process.env.XYRA_PLUGINS_DIR = originalPluginsDirEnv;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('server/utils/plugins/management', () => {
  it('updates enabled state for managed plugin manifests', async () => {
    const root = createTempRoot();
    const pluginRoot = join(root, 'extensions');
    const pluginDir = join(pluginRoot, 'acme-tools');
    const manifestPath = join(pluginDir, 'plugin.json');
    mkdirSync(pluginDir, { recursive: true });
    writePluginManifest(manifestPath, true);

    process.env.XYRA_PLUGIN_DIRS = pluginRoot;
    delete process.env.XYRA_PLUGINS_DIR;

    const updated = await setPluginManifestEnabledState(manifestPath, false);

    expect(updated.enabled).toBe(false);
    const fromDisk = JSON.parse(readFileSync(manifestPath, 'utf8')) as { enabled?: boolean };
    expect(fromDisk.enabled).toBe(false);
  });

  it('rejects manifest updates outside configured plugin directories', async () => {
    const root = createTempRoot();
    const pluginRoot = join(root, 'extensions');
    const outsideDir = join(root, 'outside');
    const outsideManifestPath = join(outsideDir, 'plugin.json');

    mkdirSync(outsideDir, { recursive: true });
    writePluginManifest(outsideManifestPath, true);

    process.env.XYRA_PLUGIN_DIRS = pluginRoot;
    delete process.env.XYRA_PLUGINS_DIR;

    let thrown: unknown;
    try {
      await setPluginManifestEnabledState(outsideManifestPath, false);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PluginManagementError);
    expect((thrown as PluginManagementError).statusCode).toBe(400);
  });

  it('rejects symlink plugin manifests', async () => {
    const root = createTempRoot();
    const pluginRoot = join(root, 'extensions');
    const pluginDir = join(pluginRoot, 'acme-tools');
    const manifestPath = join(pluginDir, 'plugin.json');
    const linkedTargetDir = join(root, 'linked-target');
    const linkedTargetPath = join(linkedTargetDir, 'plugin.json');

    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(linkedTargetDir, { recursive: true });
    writePluginManifest(linkedTargetPath, true);

    try {
      symlinkSync(linkedTargetPath, manifestPath);
    } catch {
      return;
    }

    process.env.XYRA_PLUGIN_DIRS = pluginRoot;
    delete process.env.XYRA_PLUGINS_DIR;

    let thrown: unknown;
    try {
      await setPluginManifestEnabledState(manifestPath, false);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PluginManagementError);
    expect((thrown as PluginManagementError).statusCode).toBe(400);
  });
});
