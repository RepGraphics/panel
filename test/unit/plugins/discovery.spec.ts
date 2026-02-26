import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverPlugins,
  resolvePluginNuxtLayers,
  resolvePluginNuxtModules,
} from '../../../shared/plugins/discovery';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'xyra-plugin-discovery-'));
  tempDirs.push(root);
  return root;
}

function writePluginManifest(
  root: string,
  pluginId: string,
  manifest: Record<string, unknown>,
): string {
  const pluginDir = join(root, 'extensions', pluginId);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return pluginDir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('shared/plugins/discovery', () => {
  it('discovers valid plugin manifests and resolves entry paths', () => {
    const root = makeTempRoot();
    const pluginDir = writePluginManifest(root, 'acme-tools', {
      id: 'acme-tools',
      name: 'Acme Tools',
      version: '1.0.0',
      entry: {
        server: './dist/server.mjs',
        module: './modules/xyra.ts',
        nuxtLayer: './ui',
        migrations: './migrations',
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
    });

    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    mkdirSync(join(pluginDir, 'modules'), { recursive: true });
    mkdirSync(join(pluginDir, 'ui'), { recursive: true });
    mkdirSync(join(pluginDir, 'migrations'), { recursive: true });
    writeFileSync(join(pluginDir, 'dist', 'server.mjs'), 'export default {}', 'utf8');
    writeFileSync(join(pluginDir, 'modules', 'xyra.ts'), 'export default defineNuxtModule({})', 'utf8');
    writeFileSync(join(pluginDir, 'migrations', '001_initial.sql'), 'SELECT 1;', 'utf8');

    const result = discoverPlugins({ rootDir: root });

    expect(result.errors).toHaveLength(0);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.id).toBe('acme-tools');
    expect(result.plugins[0]?.serverEntryPath).toBe(join(pluginDir, 'dist', 'server.mjs'));
    expect(result.plugins[0]?.moduleEntryPath).toBe(join(pluginDir, 'modules', 'xyra.ts'));
    expect(result.plugins[0]?.nuxtLayerPath).toBe(join(pluginDir, 'ui'));
    expect(result.plugins[0]?.migrationsPath).toBe(join(pluginDir, 'migrations'));
    expect(result.plugins[0]?.contributions?.serverNavigation).toEqual([
      {
        id: 'acme-tools-server',
        label: 'Acme Tools',
        to: 'acme-tools',
      },
    ]);
    expect(result.plugins[0]?.contributions?.dashboardNavigation).toEqual([
      {
        id: 'acme-tools-dashboard',
        label: 'Acme Tools',
        to: '/acme-tools',
      },
    ]);
  });

  it('discovers a plugin when pluginDirs points at the plugin folder directly', () => {
    const root = makeTempRoot();
    const pluginDir = join(root, 'player-listing');

    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(join(pluginDir, 'ui'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify(
        {
          id: 'player-listing',
          name: 'Player Listing',
          version: '1.0.0',
          entry: {
            nuxtLayer: './ui',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = discoverPlugins({
      rootDir: root,
      pluginDirs: ['player-listing'],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.id).toBe('player-listing');
    expect(result.plugins[0]?.sourceDir).toBe(pluginDir);
    expect(result.plugins[0]?.nuxtLayerPath).toBe(join(pluginDir, 'ui'));
  });

  it('rejects manifest entry paths that escape the plugin directory', () => {
    const root = makeTempRoot();
    writePluginManifest(root, 'unsafe-plugin', {
      id: 'unsafe-plugin',
      name: 'Unsafe Plugin',
      version: '0.1.0',
      entry: {
        server: '../outside.mjs',
      },
    });

    const result = discoverPlugins({ rootDir: root });

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.serverEntryPath).toBeUndefined();
    expect(result.errors.some((entry) => entry.message.includes('cannot escape'))).toBe(true);
  });

  it('requires entry.migrations to point to a directory', () => {
    const root = makeTempRoot();
    const pluginDir = writePluginManifest(root, 'bad-migrations', {
      id: 'bad-migrations',
      name: 'Bad Migrations',
      version: '1.0.0',
      entry: {
        migrations: './migrations.sql',
      },
    });

    writeFileSync(join(pluginDir, 'migrations.sql'), 'SELECT 1;', 'utf8');

    const result = discoverPlugins({ rootDir: root });

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.migrationsPath).toBeUndefined();
    expect(
      result.errors.some((entry) => entry.message.includes('Field "entry.migrations" must point to a directory.')),
    ).toBe(true);
  });

  it('only resolves nuxt layers for enabled plugins', () => {
    const root = makeTempRoot();
    const enabledDir = writePluginManifest(root, 'enabled-plugin', {
      id: 'enabled-plugin',
      name: 'Enabled',
      version: '1.0.0',
      enabled: true,
      entry: { nuxtLayer: './ui' },
    });
    const disabledDir = writePluginManifest(root, 'disabled-plugin', {
      id: 'disabled-plugin',
      name: 'Disabled',
      version: '1.0.0',
      enabled: false,
      entry: { nuxtLayer: './ui' },
    });

    mkdirSync(join(enabledDir, 'ui'), { recursive: true });
    mkdirSync(join(disabledDir, 'ui'), { recursive: true });
    writeFileSync(join(enabledDir, 'ui', 'nuxt.config.ts'), 'export default {}', 'utf8');
    writeFileSync(join(disabledDir, 'ui', 'nuxt.config.ts'), 'export default {}', 'utf8');

    const layers = resolvePluginNuxtLayers({ rootDir: root });

    expect(layers).toEqual([join(enabledDir, 'ui')]);
  });

  it('only resolves nuxt modules for enabled plugins', () => {
    const root = makeTempRoot();
    const enabledDir = writePluginManifest(root, 'module-enabled-plugin', {
      id: 'module-enabled-plugin',
      name: 'Enabled Module',
      version: '1.0.0',
      enabled: true,
      entry: { module: './modules/index.ts' },
    });
    const disabledDir = writePluginManifest(root, 'module-disabled-plugin', {
      id: 'module-disabled-plugin',
      name: 'Disabled Module',
      version: '1.0.0',
      enabled: false,
      entry: { module: './modules/index.ts' },
    });

    mkdirSync(join(enabledDir, 'modules'), { recursive: true });
    mkdirSync(join(disabledDir, 'modules'), { recursive: true });
    writeFileSync(join(enabledDir, 'modules', 'index.ts'), 'export default defineNuxtModule({})', 'utf8');
    writeFileSync(join(disabledDir, 'modules', 'index.ts'), 'export default defineNuxtModule({})', 'utf8');

    const modules = resolvePluginNuxtModules({ rootDir: root });

    expect(modules).toEqual([join(enabledDir, 'modules', 'index.ts')]);
  });

  it('creates a generated Nuxt layer wrapper when entry.nuxtLayer has no nuxt.config', () => {
    const root = makeTempRoot();
    const pluginDir = writePluginManifest(root, 'compat-layer-plugin', {
      id: 'compat-layer-plugin',
      name: 'Compat Layer Plugin',
      version: '1.0.0',
      entry: { nuxtLayer: './ui' },
    });

    mkdirSync(join(pluginDir, 'ui', 'app', 'pages', 'admin'), { recursive: true });
    writeFileSync(join(pluginDir, 'ui', 'app', 'pages', 'admin', 'compat.vue'), '<template />');

    const layers = resolvePluginNuxtLayers({ rootDir: root });
    const generatedLayerDir = join(root, '.xyra', 'generated-plugin-layers', 'compat-layer-plugin');
    const generatedLayerConfigPath = join(generatedLayerDir, 'nuxt.config.ts');
    const generatedPagePath = join(generatedLayerDir, 'app', 'pages', 'admin', 'compat.vue');

    expect(layers).toEqual([generatedLayerDir]);
    expect(existsSync(generatedLayerConfigPath)).toBe(true);
    expect(readFileSync(generatedLayerConfigPath, 'utf8')).toBe('export default {};\n');
    expect(existsSync(generatedPagePath)).toBe(true);
  });
});
