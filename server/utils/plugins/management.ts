import { lstat, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import type { PluginManifest } from '#shared/plugins/types';

const DEFAULT_PLUGIN_DIRS = ['extensions'];
const PLUGIN_MANIFEST_FILE = 'plugin.json';

export class PluginManagementError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'PluginManagementError';
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveInputPath(pathInput: string): string {
  const trimmed = pathInput.trim();
  if (!trimmed) {
    throw new PluginManagementError(400, 'Path is required.');
  }

  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(process.cwd(), trimmed);
}

function isPathInside(baseDir: string, candidatePath: string): boolean {
  const rel = relative(baseDir, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveConfiguredPluginDirs(rootDir: string = process.cwd()): string[] {
  const envValue = process.env.XYRA_PLUGIN_DIRS ?? process.env.XYRA_PLUGINS_DIR;

  const configuredDirs = envValue
    ? envValue
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : DEFAULT_PLUGIN_DIRS;

  return Array.from(new Set(configuredDirs.map((entry) => resolve(rootDir, entry))));
}

function serializeManifest(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function resolveConfiguredPluginRealRoots(): Promise<string[]> {
  return await Promise.all(
    resolveConfiguredPluginDirs().map(async (entry) => realpath(entry).catch(() => resolve(entry))),
  );
}

async function assertPathWithinManagedPluginRoots(path: string, label: string): Promise<void> {
  const [candidateRealPath, configuredRoots] = await Promise.all([
    realpath(path).catch(() => path),
    resolveConfiguredPluginRealRoots(),
  ]);

  const isManaged = configuredRoots.some((rootDir) => isPathInside(rootDir, candidateRealPath));
  if (!isManaged) {
    throw new PluginManagementError(
      400,
      `${label} must be inside configured plugin directories.`,
    );
  }
}

export async function setPluginManifestEnabledState(
  manifestPath: string,
  enabled: boolean,
): Promise<PluginManifest> {
  const resolvedManifestPath = resolveInputPath(manifestPath);

  if (basename(resolvedManifestPath) !== PLUGIN_MANIFEST_FILE) {
    throw new PluginManagementError(400, `Expected a ${PLUGIN_MANIFEST_FILE} path.`);
  }

  const manifestStat = await stat(resolvedManifestPath).catch(() => null);
  if (!manifestStat || !manifestStat.isFile()) {
    throw new PluginManagementError(
      404,
      `Plugin manifest was not found at ${resolvedManifestPath}.`,
    );
  }

  const manifestLinkStat = await lstat(resolvedManifestPath).catch(() => null);
  if (!manifestLinkStat || manifestLinkStat.isSymbolicLink()) {
    throw new PluginManagementError(
      400,
      `${PLUGIN_MANIFEST_FILE} must be a regular file inside a managed plugin directory.`,
    );
  }

  await assertPathWithinManagedPluginRoots(resolvedManifestPath, PLUGIN_MANIFEST_FILE);

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(await readFile(resolvedManifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new PluginManagementError(
      422,
      `Failed to parse ${PLUGIN_MANIFEST_FILE}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isRecord(manifestValue)) {
    throw new PluginManagementError(422, `${PLUGIN_MANIFEST_FILE} must be a JSON object.`);
  }

  const nextManifest: Record<string, unknown> = {
    ...manifestValue,
    enabled,
  };

  try {
    await writeFile(resolvedManifestPath, serializeManifest(nextManifest), 'utf8');
  } catch (error) {
    throw new PluginManagementError(
      500,
      `Failed to update ${PLUGIN_MANIFEST_FILE}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return nextManifest as PluginManifest;
}

export async function uninstallPluginSourceDirectory(sourceDir: string): Promise<void> {
  const resolvedSourceDir = resolveInputPath(sourceDir);
  const sourceStat = await stat(resolvedSourceDir).catch(() => null);

  if (!sourceStat || !sourceStat.isDirectory()) {
    throw new PluginManagementError(
      404,
      `Plugin source directory was not found: ${resolvedSourceDir}.`,
    );
  }

  const sourceRealPath = await realpath(resolvedSourceDir).catch(() => resolvedSourceDir);
  const configuredRoots = await resolveConfiguredPluginRealRoots();

  const isManagedDirectory = configuredRoots.some((rootDir) =>
    isPathInside(rootDir, sourceRealPath),
  );
  if (!isManagedDirectory) {
    throw new PluginManagementError(
      400,
      'Refusing to uninstall a plugin outside configured plugin directories.',
    );
  }

  if (configuredRoots.some((rootDir) => rootDir === sourceRealPath)) {
    throw new PluginManagementError(
      409,
      'This plugin is located at a configured plugin root. Remove it manually to avoid deleting the full root directory.',
    );
  }

  try {
    await rm(sourceRealPath, { recursive: true, force: true });
  } catch (error) {
    throw new PluginManagementError(
      500,
      `Failed to remove plugin directory: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
