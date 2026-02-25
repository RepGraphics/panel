import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { PluginManifest } from '#shared/plugins/types';

const execFileAsync = promisify(execFile);
const PLUGIN_MANIFEST_FILE = 'plugin.json';
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_MANIFEST_SCAN_DEPTH = 6;
const MANIFEST_SCAN_IGNORE = new Set(['.git', '.hg', '.svn', 'node_modules', '.nuxt', '.output']);
const ARCHIVE_LIST_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_COUNT = 10_000;
const MAX_ARCHIVE_ENTRY_PATH_LENGTH = 1024;
const KNOWN_ARCHIVE_ENTRY_TYPES = new Set(['-', 'd', 'b', 'c', 'h', 'l', 'p', 's', 'x', 'g']);
const SUPPORTED_ARCHIVE_ENTRY_TYPES = new Set(['-', 'd', 'x', 'g']);

interface NormalizedPluginManifest extends PluginManifest {
  id: string;
  name: string;
  version: string;
}

export interface PluginInstallOptions {
  force?: boolean;
  manifestPath?: string;
  installRoot?: string;
}

export interface PluginInstallResult {
  id: string;
  name: string;
  version: string;
  manifestPath: string;
  sourceDir: string;
  destinationDir: string;
  replaced: boolean;
  restartRequired: boolean;
}

export class PluginInstallError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'PluginInstallError';
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasNuxtRuntimeEntries(manifest: NormalizedPluginManifest): boolean {
  const nuxtLayer = manifest.entry?.nuxtLayer;
  const nuxtModule = manifest.entry?.module;

  return (
    (typeof nuxtLayer === 'string' && nuxtLayer.trim().length > 0) ||
    (typeof nuxtModule === 'string' && nuxtModule.trim().length > 0)
  );
}

function resolveInputPath(pathInput: string): string {
  const trimmed = pathInput.trim();
  if (!trimmed) {
    throw new PluginInstallError(400, 'A plugin source path is required.');
  }

  return isAbsolute(trimmed) ? normalize(trimmed) : resolve(process.cwd(), trimmed);
}

function ensurePathInsideRoot(rootDir: string, targetPath: string, label: string): void {
  const rel = relative(rootDir, targetPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new PluginInstallError(400, `${label} cannot escape the selected source directory.`);
  }
}

function findManifestCandidates(sourceRoot: string): string[] {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: sourceRoot, depth: 0 }];
  const manifests: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let entries;
    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === PLUGIN_MANIFEST_FILE && entry.isFile()) {
        manifests.push(join(current.dir, entry.name));
        continue;
      }

      if (!entry.isDirectory()) {
        continue;
      }

      if (current.depth >= MAX_MANIFEST_SCAN_DEPTH) {
        continue;
      }

      if (MANIFEST_SCAN_IGNORE.has(entry.name)) {
        continue;
      }

      queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  return manifests.sort((a, b) => a.localeCompare(b));
}

async function resolveSourceManifestPath(
  sourcePath: string,
  manifestPath: string | undefined,
): Promise<string> {
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat) {
    throw new PluginInstallError(404, `Plugin source does not exist: ${sourcePath}`);
  }

  if (sourceStat.isFile()) {
    if (basename(sourcePath) !== PLUGIN_MANIFEST_FILE) {
      throw new PluginInstallError(400, `Source file must be ${PLUGIN_MANIFEST_FILE}.`);
    }
    return sourcePath;
  }

  if (manifestPath && manifestPath.trim().length > 0) {
    const requested = manifestPath.trim();
    const candidate = requested.endsWith(PLUGIN_MANIFEST_FILE)
      ? resolve(sourcePath, requested)
      : resolve(sourcePath, requested, PLUGIN_MANIFEST_FILE);

    ensurePathInsideRoot(sourcePath, candidate, 'Manifest path');

    if (!existsSync(candidate)) {
      throw new PluginInstallError(
        404,
        `Cannot find ${PLUGIN_MANIFEST_FILE} at requested manifest path: ${requested}`,
      );
    }

    return candidate;
  }

  const directManifest = join(sourcePath, PLUGIN_MANIFEST_FILE);
  if (existsSync(directManifest)) {
    return directManifest;
  }

  const manifests = findManifestCandidates(sourcePath);
  if (manifests.length === 0) {
    throw new PluginInstallError(
      400,
      `No ${PLUGIN_MANIFEST_FILE} found in source path. Provide manifestPath when needed.`,
    );
  }

  if (manifests.length > 1) {
    const preview = manifests.slice(0, 5).map((entry) => ` - ${relative(sourcePath, entry)}`);
    throw new PluginInstallError(
      400,
      `Multiple plugin manifests found. Provide manifestPath.\n${preview.join('\n')}`,
    );
  }

  return manifests[0]!;
}

async function readAndValidateManifest(manifestPath: string): Promise<NormalizedPluginManifest> {
  let parsed: unknown;

  try {
    const raw = await readFile(manifestPath, 'utf8');
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new PluginInstallError(
      400,
      `Failed to parse ${PLUGIN_MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new PluginInstallError(400, `${PLUGIN_MANIFEST_FILE} must be a JSON object.`);
  }

  const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const version = typeof parsed.version === 'string' ? parsed.version.trim() : '';

  if (!id || !PLUGIN_ID_PATTERN.test(id)) {
    throw new PluginInstallError(
      400,
      `Invalid plugin id in ${PLUGIN_MANIFEST_FILE}. Expected pattern ${PLUGIN_ID_PATTERN}.`,
    );
  }

  if (!name) {
    throw new PluginInstallError(400, `${PLUGIN_MANIFEST_FILE} is missing "name".`);
  }

  if (!version) {
    throw new PluginInstallError(400, `${PLUGIN_MANIFEST_FILE} is missing "version".`);
  }

  return {
    ...(parsed as PluginManifest),
    id,
    name,
    version,
  };
}

function resolveManagedInstallRoot(options: PluginInstallOptions): string {
  if (options.installRoot && options.installRoot.trim().length > 0) {
    return resolveInputPath(options.installRoot);
  }

  const explicitRoot = process.env.XYRA_PLUGIN_INSTALL_DIR?.trim();
  if (explicitRoot) {
    return resolveInputPath(explicitRoot);
  }

  const configured = process.env.XYRA_PLUGIN_DIRS ?? process.env.XYRA_PLUGINS_DIR;
  if (configured) {
    const candidates = configured
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      const resolvedCandidate = resolveInputPath(candidate);
      if (existsSync(join(resolvedCandidate, PLUGIN_MANIFEST_FILE))) {
        continue;
      }

      return resolvedCandidate;
    }
  }

  return resolve(process.cwd(), 'extensions');
}

function sanitizeArchiveFilename(name: string | undefined): string {
  const base = basename(name?.trim() || 'plugin-upload.tar');
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized.length > 0 ? sanitized : 'plugin-upload.tar';
}

function validateArchiveEntries(entries: string[]): void {
  if (entries.length === 0) {
    throw new PluginInstallError(400, 'Uploaded archive is empty.');
  }

  if (entries.length > MAX_ARCHIVE_ENTRY_COUNT) {
    throw new PluginInstallError(
      413,
      `Archive has too many entries (${entries.length}). Limit is ${MAX_ARCHIVE_ENTRY_COUNT}.`,
    );
  }

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }

    const normalizedEntry = entry.replace(/\\/g, '/');
    if (normalizedEntry.length > MAX_ARCHIVE_ENTRY_PATH_LENGTH) {
      throw new PluginInstallError(
        400,
        `Archive entry path is too long. Maximum length is ${MAX_ARCHIVE_ENTRY_PATH_LENGTH}.`,
      );
    }

    if (normalizedEntry.includes('\0')) {
      throw new PluginInstallError(400, 'Archive contains invalid null-byte paths.');
    }

    if (normalizedEntry.startsWith('/') || /^[a-zA-Z]:\//.test(normalizedEntry)) {
      throw new PluginInstallError(400, 'Archive contains absolute paths and cannot be installed.');
    }

    const segments = normalizedEntry.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '..')) {
      throw new PluginInstallError(400, 'Archive contains invalid relative traversal paths.');
    }
  }
}

function validateArchiveEntryTypes(verboseListOutput: string): void {
  const lines = verboseListOutput
    .split(/\r?\n/)
    .map((line) => line.trimStart())
    .filter(Boolean);

  for (const line of lines) {
    const entryType = line[0];
    if (!entryType || !KNOWN_ARCHIVE_ENTRY_TYPES.has(entryType)) {
      continue;
    }

    if (!SUPPORTED_ARCHIVE_ENTRY_TYPES.has(entryType)) {
      throw new PluginInstallError(
        400,
        'Archive contains unsupported entry types (symlinks/devices/fifos) and cannot be installed.',
      );
    }
  }
}

async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  let listOutput = '';
  try {
    const result = await execFileAsync('tar', ['-tf', archivePath], {
      maxBuffer: ARCHIVE_LIST_MAX_BUFFER_BYTES,
    });
    listOutput = result.stdout ?? '';
  } catch (error) {
    throw new PluginInstallError(
      422,
      `Invalid or unsupported plugin archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const entries = listOutput
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  validateArchiveEntries(entries);

  let verboseListOutput = '';
  try {
    const result = await execFileAsync('tar', ['-tvf', archivePath], {
      maxBuffer: ARCHIVE_LIST_MAX_BUFFER_BYTES,
    });
    verboseListOutput = result.stdout ?? '';
  } catch (error) {
    throw new PluginInstallError(
      422,
      `Invalid or unsupported plugin archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  validateArchiveEntryTypes(verboseListOutput);

  await mkdir(targetDir, { recursive: true });

  try {
    await execFileAsync('tar', ['-xf', archivePath, '-C', targetDir], {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    throw new PluginInstallError(
      422,
      `Failed to extract plugin archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function installPluginFromLocalSource(
  sourcePath: string,
  options: PluginInstallOptions = {},
): Promise<PluginInstallResult> {
  const sourceRoot = resolveInputPath(sourcePath);
  const manifestPath = await resolveSourceManifestPath(sourceRoot, options.manifestPath);
  const manifest = await readAndValidateManifest(manifestPath);
  const sourceDir = dirname(manifestPath);

  const installRoot = resolveManagedInstallRoot(options);
  const destinationDir = join(installRoot, manifest.id);

  let replaced = false;

  if (existsSync(destinationDir)) {
    const [sourceReal, destinationReal] = await Promise.all([
      realpath(sourceDir).catch(() => sourceDir),
      realpath(destinationDir).catch(() => destinationDir),
    ]);

    if (sourceReal === destinationReal) {
      return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        manifestPath,
        sourceDir,
        destinationDir,
        replaced: false,
        restartRequired: hasNuxtRuntimeEntries(manifest),
      };
    }

    if (!options.force) {
      throw new PluginInstallError(
        409,
        `Plugin "${manifest.id}" already exists. Enable force to overwrite.`,
      );
    }

    await rm(destinationDir, { recursive: true, force: true });
    replaced = true;
  }

  await mkdir(installRoot, { recursive: true });
  await cp(sourceDir, destinationDir, { recursive: true });

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    manifestPath,
    sourceDir,
    destinationDir,
    replaced,
    restartRequired: hasNuxtRuntimeEntries(manifest),
  };
}

export async function installPluginFromArchiveBuffer(
  archiveData: Buffer,
  options: PluginInstallOptions & { archiveFilename?: string } = {},
): Promise<PluginInstallResult> {
  if (!Buffer.isBuffer(archiveData) || archiveData.length === 0) {
    throw new PluginInstallError(400, 'Plugin archive payload is empty.');
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'xyra-plugin-upload-'));
  const archivePath = join(tempRoot, sanitizeArchiveFilename(options.archiveFilename));
  const extractedDir = join(tempRoot, 'extracted');

  try {
    await writeFile(archivePath, archiveData);
    await extractArchive(archivePath, extractedDir);

    return await installPluginFromLocalSource(extractedDir, {
      force: options.force,
      manifestPath: options.manifestPath,
      installRoot: options.installRoot,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
