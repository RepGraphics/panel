import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  type Dirent,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type {
  PluginDiscoveryError,
  PluginDiscoveryOptions,
  PluginDiscoveryResult,
  PluginManifest,
  ResolvedPluginManifest,
  PluginSlotContribution,
} from '#shared/plugins/types';
import type { AdminNavItem } from '#shared/types/admin';

const DEFAULT_PLUGIN_DIRS = ['extensions'];
const PLUGIN_MANIFEST_FILE = 'plugin.json';
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const NUXT_LAYER_CONFIG_FILES = [
  'nuxt.config.ts',
  'nuxt.config.mts',
  'nuxt.config.cts',
  'nuxt.config.js',
  'nuxt.config.mjs',
  'nuxt.config.cjs',
] as const;
const GENERATED_LAYER_ROOT = '.xyra/generated-plugin-layers';
const GENERATED_LAYER_CONFIG_FILE = 'nuxt.config.ts';
const GENERATED_LAYER_CONFIG_CONTENT = 'export default {};\n';
const LAYER_COPY_IGNORE_SEGMENTS = new Set(['node_modules', '.nuxt', '.output']);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function normalizePermissionValue(value: unknown): string | string[] | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (isStringArray(value)) {
    const normalized = value.map((entry) => entry.trim()).filter(Boolean);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeAdminNavItem(value: unknown): AdminNavItem | null {
  if (!isObject(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const label = typeof value.label === 'string' ? value.label.trim() : '';

  if (!id || !label) {
    return null;
  }

  const navItem: AdminNavItem = { id, label };

  if (typeof value.to === 'string' && value.to.trim().length > 0) {
    navItem.to = value.to.trim();
  }

  if (typeof value.icon === 'string' && value.icon.trim().length > 0) {
    navItem.icon = value.icon.trim();
  }

  if (typeof value.order === 'number' && Number.isFinite(value.order)) {
    navItem.order = value.order;
  }

  const permission = normalizePermissionValue(value.permission);
  if (permission) {
    navItem.permission = permission;
  }

  if (Array.isArray(value.children)) {
    const children = value.children
      .map((child) => normalizeAdminNavItem(child))
      .filter((child): child is AdminNavItem => Boolean(child));

    if (children.length > 0) {
      navItem.children = children;
    }
  }

  return navItem;
}

function normalizeSlotContribution(value: unknown): PluginSlotContribution | null {
  if (!isObject(value)) {
    return null;
  }

  const slot = typeof value.slot === 'string' ? value.slot.trim() : '';
  const component = typeof value.component === 'string' ? value.component.trim() : '';

  if (!slot || !component) {
    return null;
  }

  const contribution: PluginSlotContribution = { slot, component };

  if (typeof value.order === 'number' && Number.isFinite(value.order)) {
    contribution.order = value.order;
  }

  const permission = normalizePermissionValue(value.permission);
  if (permission) {
    contribution.permission = permission;
  }

  if (isObject(value.props)) {
    contribution.props = value.props;
  }

  return contribution;
}

function resolveConfiguredPluginDirs(options: PluginDiscoveryOptions): string[] {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const envValue = process.env.XYRA_PLUGIN_DIRS ?? process.env.XYRA_PLUGINS_DIR;

  const configuredDirs =
    options.pluginDirs ??
    (envValue
      ? envValue
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : DEFAULT_PLUGIN_DIRS);

  return Array.from(
    new Set(
      configuredDirs.map((entry) => resolve(rootDir, entry)).filter((entry) => entry.length > 0),
    ),
  );
}

function isPathInside(baseDir: string, candidatePath: string): boolean {
  const rel = relative(baseDir, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveManifestEntryPath(
  sourceDir: string,
  entryPath: string,
  fieldName: string,
  manifestPath: string,
  errors: PluginDiscoveryError[],
): string | undefined {
  const normalizedEntry = entryPath.trim();

  if (normalizedEntry.length === 0) {
    return undefined;
  }

  if (isAbsolute(normalizedEntry)) {
    errors.push({
      manifestPath,
      message: `Field "${fieldName}" must be a relative path.`,
    });
    return undefined;
  }

  const resolvedPath = resolve(sourceDir, normalizedEntry);

  if (!isPathInside(sourceDir, resolvedPath)) {
    errors.push({
      manifestPath,
      message: `Field "${fieldName}" cannot escape the plugin directory.`,
    });
    return undefined;
  }

  if (!existsSync(resolvedPath)) {
    errors.push({
      manifestPath,
      message: `Field "${fieldName}" points to a missing file or directory: ${normalizedEntry}`,
    });
    return undefined;
  }

  return resolvedPath;
}

function parsePluginManifest(
  value: unknown,
  manifestPath: string,
  errors: PluginDiscoveryError[],
): PluginManifest | null {
  if (!isObject(value)) {
    errors.push({ manifestPath, message: 'Plugin manifest must be a JSON object.' });
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const version = typeof value.version === 'string' ? value.version.trim() : '';

  if (!id) {
    errors.push({ manifestPath, message: 'Plugin manifest is missing "id".' });
    return null;
  }

  if (!PLUGIN_ID_PATTERN.test(id)) {
    errors.push({
      pluginId: id,
      manifestPath,
      message:
        'Plugin "id" can only include lowercase letters, numbers, dots, dashes, and underscores.',
    });
    return null;
  }

  if (!name) {
    errors.push({ pluginId: id, manifestPath, message: 'Plugin manifest is missing "name".' });
    return null;
  }

  if (!version) {
    errors.push({ pluginId: id, manifestPath, message: 'Plugin manifest is missing "version".' });
    return null;
  }

  const manifest: PluginManifest = { id, name, version };

  if (typeof value.description === 'string' && value.description.trim().length > 0) {
    manifest.description = value.description.trim();
  }

  if (typeof value.author === 'string' && value.author.trim().length > 0) {
    manifest.author = value.author.trim();
  }

  if (typeof value.website === 'string' && value.website.trim().length > 0) {
    manifest.website = value.website.trim();
  }

  if (typeof value.enabled === 'boolean') {
    manifest.enabled = value.enabled;
  }

  if (isObject(value.entry)) {
    const entry: PluginManifest['entry'] = {};

    if (typeof value.entry.server === 'string') {
      entry.server = value.entry.server.trim();
    }

    if (typeof value.entry.module === 'string') {
      entry.module = value.entry.module.trim();
    }

    if (typeof value.entry.nuxtLayer === 'string') {
      entry.nuxtLayer = value.entry.nuxtLayer.trim();
    }

    if (entry.server || entry.module || entry.nuxtLayer) {
      manifest.entry = entry;
    }
  }

  if (isObject(value.contributions)) {
    const contributions: NonNullable<PluginManifest['contributions']> = {};

    if (Array.isArray(value.contributions.adminNavigation)) {
      const adminNavigation = value.contributions.adminNavigation
        .map((entry) => normalizeAdminNavItem(entry))
        .filter((entry): entry is AdminNavItem => Boolean(entry));

      if (adminNavigation.length > 0) {
        contributions.adminNavigation = adminNavigation;
      }
    }

    if (Array.isArray(value.contributions.dashboardNavigation)) {
      const dashboardNavigation = value.contributions.dashboardNavigation
        .map((entry) => normalizeAdminNavItem(entry))
        .filter((entry): entry is AdminNavItem => Boolean(entry));

      if (dashboardNavigation.length > 0) {
        contributions.dashboardNavigation = dashboardNavigation;
      }
    }

    if (Array.isArray(value.contributions.serverNavigation)) {
      const serverNavigation = value.contributions.serverNavigation
        .map((entry) => normalizeAdminNavItem(entry))
        .filter((entry): entry is AdminNavItem => Boolean(entry));

      if (serverNavigation.length > 0) {
        contributions.serverNavigation = serverNavigation;
      }
    }

    if (Array.isArray(value.contributions.uiSlots)) {
      const uiSlots = value.contributions.uiSlots
        .map((entry) => normalizeSlotContribution(entry))
        .filter((entry): entry is PluginSlotContribution => Boolean(entry));

      if (uiSlots.length > 0) {
        contributions.uiSlots = uiSlots;
      }
    }

    if (
      contributions.adminNavigation ||
      contributions.dashboardNavigation ||
      contributions.serverNavigation ||
      contributions.uiSlots
    ) {
      manifest.contributions = contributions;
    }
  }

  return manifest;
}

function readPluginManifestFile(manifestPath: string): unknown {
  const raw = readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw) as unknown;
}

function hasNuxtLayerConfig(layerDir: string): boolean {
  return NUXT_LAYER_CONFIG_FILES.some((fileName) => existsSync(join(layerDir, fileName)));
}

function shouldCopyNuxtLayerPath(layerRoot: string, candidatePath: string): boolean {
  const relPath = relative(layerRoot, candidatePath);
  if (!relPath || relPath === '.') {
    return true;
  }

  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => LAYER_COPY_IGNORE_SEGMENTS.has(segment))) {
    return false;
  }

  return !NUXT_LAYER_CONFIG_FILES.includes(
    basename(candidatePath).toLowerCase() as (typeof NUXT_LAYER_CONFIG_FILES)[number],
  );
}

function ensureGeneratedNuxtLayer(rootDir: string, plugin: ResolvedPluginManifest): string {
  const nuxtLayerPath = plugin.nuxtLayerPath;
  if (!nuxtLayerPath) {
    throw new Error(`Plugin "${plugin.id}" does not define "entry.nuxtLayer".`);
  }

  if (hasNuxtLayerConfig(nuxtLayerPath)) {
    return nuxtLayerPath;
  }

  const layerWrapperDir = join(rootDir, GENERATED_LAYER_ROOT, plugin.id);
  const layerWrapperConfigPath = join(layerWrapperDir, GENERATED_LAYER_CONFIG_FILE);

  try {
    rmSync(layerWrapperDir, { recursive: true, force: true });
    mkdirSync(layerWrapperDir, { recursive: true });
    cpSync(nuxtLayerPath, layerWrapperDir, {
      recursive: true,
      filter: (sourcePath) => shouldCopyNuxtLayerPath(nuxtLayerPath, sourcePath),
    });

    writeFileSync(layerWrapperConfigPath, GENERATED_LAYER_CONFIG_CONTENT, 'utf8');
  } catch (error) {
    console.warn(
      `[plugins] Failed to generate Nuxt layer wrapper for "${plugin.id}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return nuxtLayerPath;
  }

  return layerWrapperDir;
}

export function isPluginEnabled(manifest: PluginManifest): boolean {
  return manifest.enabled !== false;
}

function addDiscoveredPluginFromSourceDir(
  sourceDir: string,
  errors: PluginDiscoveryError[],
  seenPluginIds: Set<string>,
  plugins: ResolvedPluginManifest[],
): void {
  const manifestPath = join(sourceDir, PLUGIN_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return;
  }

  let manifestValue: unknown;
  try {
    manifestValue = readPluginManifestFile(manifestPath);
  } catch (error) {
    errors.push({
      manifestPath,
      message: `Failed to parse plugin manifest: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  const manifest = parsePluginManifest(manifestValue, manifestPath, errors);
  if (!manifest) {
    return;
  }

  if (seenPluginIds.has(manifest.id)) {
    errors.push({
      pluginId: manifest.id,
      manifestPath,
      message: `Duplicate plugin id "${manifest.id}" detected.`,
    });
    return;
  }

  seenPluginIds.add(manifest.id);

  const resolvedManifest: ResolvedPluginManifest = {
    ...manifest,
    sourceDir,
    manifestPath,
  };

  if (manifest.entry?.server) {
    const serverEntryPath = resolveManifestEntryPath(
      sourceDir,
      manifest.entry.server,
      'entry.server',
      manifestPath,
      errors,
    );

    if (serverEntryPath) {
      resolvedManifest.serverEntryPath = serverEntryPath;
    }
  }

  if (manifest.entry?.module) {
    const moduleEntryPath = resolveManifestEntryPath(
      sourceDir,
      manifest.entry.module,
      'entry.module',
      manifestPath,
      errors,
    );

    if (moduleEntryPath) {
      try {
        if (statSync(moduleEntryPath).isFile()) {
          resolvedManifest.moduleEntryPath = moduleEntryPath;
        } else {
          errors.push({
            pluginId: manifest.id,
            manifestPath,
            message: 'Field "entry.module" must point to a file.',
          });
        }
      } catch (error) {
        errors.push({
          pluginId: manifest.id,
          manifestPath,
          message: `Failed to read "entry.module": ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  if (manifest.entry?.nuxtLayer) {
    const nuxtLayerPath = resolveManifestEntryPath(
      sourceDir,
      manifest.entry.nuxtLayer,
      'entry.nuxtLayer',
      manifestPath,
      errors,
    );

    if (nuxtLayerPath) {
      try {
        if (statSync(nuxtLayerPath).isDirectory()) {
          resolvedManifest.nuxtLayerPath = nuxtLayerPath;
        } else {
          errors.push({
            pluginId: manifest.id,
            manifestPath,
            message: 'Field "entry.nuxtLayer" must point to a directory.',
          });
        }
      } catch (error) {
        errors.push({
          pluginId: manifest.id,
          manifestPath,
          message: `Failed to read "entry.nuxtLayer": ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  plugins.push(resolvedManifest);
}

export function discoverPlugins(options: PluginDiscoveryOptions = {}): PluginDiscoveryResult {
  const errors: PluginDiscoveryError[] = [];
  const plugins: ResolvedPluginManifest[] = [];
  const seenPluginIds = new Set<string>();

  for (const pluginDir of resolveConfiguredPluginDirs(options)) {
    if (!existsSync(pluginDir)) {
      continue;
    }

    // Support passing a direct plugin folder path (contains plugin.json).
    addDiscoveredPluginFromSourceDir(pluginDir, errors, seenPluginIds, plugins);

    let dirEntries: Dirent[];
    try {
      dirEntries = readdirSync(pluginDir, { withFileTypes: true });
    } catch (error) {
      errors.push({
        manifestPath: pluginDir,
        message: `Failed to read plugin directory: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    for (const entry of dirEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourceDir = join(pluginDir, entry.name);
      addDiscoveredPluginFromSourceDir(sourceDir, errors, seenPluginIds, plugins);
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));

  return { plugins, errors };
}

export function resolvePluginNuxtLayers(options: PluginDiscoveryOptions = {}): string[] {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const { plugins } = discoverPlugins(options);
  const layers = plugins
    .filter((plugin) => isPluginEnabled(plugin) && Boolean(plugin.nuxtLayerPath))
    .map((plugin) => ensureGeneratedNuxtLayer(rootDir, plugin))
    .filter((entry): entry is string => typeof entry === 'string');

  return Array.from(new Set(layers));
}

export function resolvePluginNuxtModules(options: PluginDiscoveryOptions = {}): string[] {
  const { plugins } = discoverPlugins(options);
  const modules = plugins
    .filter((plugin) => isPluginEnabled(plugin) && Boolean(plugin.moduleEntryPath))
    .map((plugin) => plugin.moduleEntryPath)
    .filter((entry): entry is string => typeof entry === 'string');

  return Array.from(new Set(modules));
}
