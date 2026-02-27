import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
  cp,
  lstat,
  readdir,
} from 'node:fs/promises';
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
const MAX_SOURCE_ENTRY_COUNT = 20_000;
const KNOWN_ARCHIVE_ENTRY_TYPES = new Set(['-', 'd', 'b', 'c', 'h', 'l', 'p', 's', 'x', 'g']);
const SUPPORTED_ARCHIVE_ENTRY_TYPES = new Set(['-', 'd', 'x', 'g']);
const ARCHIVE_EXTRACT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const DEFAULT_PLUGIN_INSTALL_DIR = 'extensions';
const ZIP_SIGNATURES: ReadonlyArray<ReadonlyArray<number>> = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];
const UNSUPPORTED_ENTRY_TYPES_ERROR_MESSAGE =
  'Archive contains unsupported entry types (symlinks/devices/fifos) and cannot be installed.';
const panelPluginSystemVersion = (() => {
  try {
    const packageJsonPath = resolve(process.cwd(), 'package.json');
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PluginSystemPackageJson;
    if (typeof parsed.xyra?.pluginSystemVersion === 'string') {
      return parsed.xyra.pluginSystemVersion.trim();
    }
  } catch {}

  return '';
})();

type ArchiveFormat = 'tar' | 'zip';

interface NormalizedPluginManifest extends PluginManifest {
  id: string;
  name: string;
  version: string;
  compatibility: string;
  description: string;
  author: string;
  website: string;
}

interface PluginSystemPackageJson {
  xyra?: {
    pluginSystemVersion?: string;
  };
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

function hasZipFileSignature(buffer: Buffer): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }

  return ZIP_SIGNATURES.some(
    (signature) =>
      buffer[0] === signature[0] &&
      buffer[1] === signature[1] &&
      buffer[2] === signature[2] &&
      buffer[3] === signature[3],
  );
}

function detectArchiveFormat(archiveData: Buffer, archiveFilename: string | undefined): ArchiveFormat {
  const normalizedName = archiveFilename?.trim().toLowerCase() ?? '';
  if (normalizedName.endsWith('.zip')) {
    return 'zip';
  }

  if (hasZipFileSignature(archiveData)) {
    return 'zip';
  }

  return 'tar';
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
  const compatibility =
    typeof parsed.compatibility === 'string' ? parsed.compatibility.trim() : '';
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const author = typeof parsed.author === 'string' ? parsed.author.trim() : '';
  const website = typeof parsed.website === 'string' ? parsed.website.trim() : '';

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

  if (!compatibility) {
    throw new PluginInstallError(400, `${PLUGIN_MANIFEST_FILE} is missing "compatibility".`);
  }

  if (!description) {
    throw new PluginInstallError(400, `${PLUGIN_MANIFEST_FILE} is missing "description".`);
  }

  if (!author) {
    throw new PluginInstallError(400, `${PLUGIN_MANIFEST_FILE} is missing "author".`);
  }

  if (!website) {
    throw new PluginInstallError(400, `${PLUGIN_MANIFEST_FILE} is missing "website".`);
  }

  if (!panelPluginSystemVersion) {
    throw new PluginInstallError(
      500,
      'Plugin system version is not configured. Set "xyra.pluginSystemVersion" in package.json.',
    );
  }

  if (compatibility !== panelPluginSystemVersion) {
    throw new PluginInstallError(
      400,
      `Plugin compatibility "${compatibility}" does not match panel plugin system version "${panelPluginSystemVersion}".`,
    );
  }

  return {
    ...(parsed as PluginManifest),
    id,
    name,
    version,
    compatibility,
    description,
    author,
    website,
  };
}

async function setInstalledPluginManifestEnabled(manifestPath: string): Promise<void> {
  let parsed: unknown;

  try {
    const raw = await readFile(manifestPath, 'utf8');
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new PluginInstallError(
      500,
      `Failed to update installed ${PLUGIN_MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new PluginInstallError(
      500,
      `Installed ${PLUGIN_MANIFEST_FILE} must be a JSON object.`,
    );
  }

  const nextManifest: Record<string, unknown> = {
    ...parsed,
    enabled: true,
  };

  try {
    await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  } catch (error) {
    throw new PluginInstallError(
      500,
      `Failed to persist installed ${PLUGIN_MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function resolveManagedInstallRoot(options: PluginInstallOptions): string {
  if (options.installRoot && options.installRoot.trim().length > 0) {
    return resolveInputPath(options.installRoot);
  }

  const explicitRoot = process.env.XYRA_PLUGIN_INSTALL_DIR?.trim();
  if (explicitRoot) {
    return resolveInputPath(explicitRoot);
  }

  return resolve(process.cwd(), DEFAULT_PLUGIN_INSTALL_DIR);
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
      throw new PluginInstallError(400, UNSUPPORTED_ENTRY_TYPES_ERROR_MESSAGE);
    }
  }
}

function isMissingBinaryError(error: unknown, binary: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    stderr?: unknown;
    shortMessage?: unknown;
  };
  if (candidate.code === 'ENOENT') {
    return true;
  }

  const normalizedBinary = binary.toLowerCase();
  const details = [candidate.message, candidate.stderr, candidate.shortMessage]
    .map((entry) => (typeof entry === 'string' ? entry.toLowerCase() : ''))
    .join('\n');

  return (
    details.includes(`${normalizedBinary}: command not found`) ||
    details.includes(`spawn ${normalizedBinary} enoent`) ||
    details.includes(`'${normalizedBinary}' is not recognized`) ||
    details.includes(`"${normalizedBinary}" is not recognized`)
  );
}

async function assertDirectoryTreeSafe(
  rootDir: string,
  options: { label: string; maxEntries: number },
): Promise<void> {
  const rootStats = await lstat(rootDir).catch(() => null);
  if (!rootStats || !rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new PluginInstallError(400, `${options.label} must be a normal directory.`);
  }

  const queue: string[] = [rootDir];
  let visitedEntries = 0;

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      throw new PluginInstallError(
        422,
        `Failed to read ${options.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const entry of entries) {
      const candidatePath = join(currentDir, entry.name);
      const stats = await lstat(candidatePath).catch(() => null);
      if (!stats) {
        throw new PluginInstallError(
          422,
          `Failed to inspect ${options.label}: ${relative(rootDir, candidatePath) || entry.name}`,
        );
      }

      visitedEntries += 1;
      if (visitedEntries > options.maxEntries) {
        throw new PluginInstallError(
          413,
          `${options.label} contains too many entries. Limit is ${options.maxEntries}.`,
        );
      }

      if (stats.isSymbolicLink()) {
        throw new PluginInstallError(400, UNSUPPORTED_ENTRY_TYPES_ERROR_MESSAGE);
      }

      if (stats.isDirectory()) {
        queue.push(candidatePath);
        continue;
      }

      if (!stats.isFile()) {
        throw new PluginInstallError(400, UNSUPPORTED_ENTRY_TYPES_ERROR_MESSAGE);
      }
    }
  }
}

async function extractTarArchive(archivePath: string, targetDir: string): Promise<void> {
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
      maxBuffer: ARCHIVE_EXTRACT_MAX_BUFFER_BYTES,
    });
  } catch (error) {
    throw new PluginInstallError(
      422,
      `Failed to extract plugin archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function extractZipArchiveWithUnzip(archivePath: string, targetDir: string): Promise<void> {
  let listOutput = '';
  try {
    const result = await execFileAsync('unzip', ['-Z1', archivePath], {
      maxBuffer: ARCHIVE_LIST_MAX_BUFFER_BYTES,
    });
    listOutput = result.stdout ?? '';
  } catch (error) {
    if (isMissingBinaryError(error, 'unzip')) {
      throw new PluginInstallError(
        500,
        'Unable to extract .zip plugin archive because "unzip" is not installed on the panel host.',
      );
    }

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

  await mkdir(targetDir, { recursive: true });

  try {
    await execFileAsync('unzip', ['-qq', '-o', archivePath, '-d', targetDir], {
      maxBuffer: ARCHIVE_EXTRACT_MAX_BUFFER_BYTES,
    });
  } catch (error) {
    if (isMissingBinaryError(error, 'unzip')) {
      throw new PluginInstallError(
        500,
        'Unable to extract .zip plugin archive because "unzip" is not installed on the panel host.',
      );
    }

    throw new PluginInstallError(
      422,
      `Failed to extract plugin archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function extractArchive(
  archivePath: string,
  targetDir: string,
  options: { format: ArchiveFormat },
): Promise<void> {
  if (options.format === 'zip') {
    try {
      await extractZipArchiveWithUnzip(archivePath, targetDir);
    } catch (error) {
      if (
        error instanceof PluginInstallError &&
        error.statusCode === 500 &&
        error.message.includes('"unzip"')
      ) {
        try {
          await extractTarArchive(archivePath, targetDir);
        } catch {
          throw error;
        }
      } else {
        throw error;
      }
    }
  } else {
    await extractTarArchive(archivePath, targetDir);
  }

  await assertDirectoryTreeSafe(targetDir, {
    label: 'Archive',
    maxEntries: MAX_ARCHIVE_ENTRY_COUNT,
  });
}

export async function installPluginFromLocalSource(
  sourcePath: string,
  options: PluginInstallOptions = {},
): Promise<PluginInstallResult> {
  const sourceRoot = resolveInputPath(sourcePath);
  const manifestPath = await resolveSourceManifestPath(sourceRoot, options.manifestPath);
  const manifest = await readAndValidateManifest(manifestPath);
  const sourceDir = dirname(manifestPath);

  await assertDirectoryTreeSafe(sourceDir, {
    label: 'Plugin source',
    maxEntries: MAX_SOURCE_ENTRY_COUNT,
  });

  const installRoot = resolveManagedInstallRoot(options);
  const destinationDir = join(installRoot, manifest.id);

  let replaced = false;

  if (existsSync(destinationDir)) {
    const [sourceReal, destinationReal] = await Promise.all([
      realpath(sourceDir).catch(() => sourceDir),
      realpath(destinationDir).catch(() => destinationDir),
    ]);

    if (sourceReal === destinationReal) {
      await setInstalledPluginManifestEnabled(manifestPath);

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
  await setInstalledPluginManifestEnabled(join(destinationDir, PLUGIN_MANIFEST_FILE));

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
  const archiveFormat = detectArchiveFormat(archiveData, options.archiveFilename);

  try {
    await writeFile(archivePath, archiveData);
    await extractArchive(archivePath, extractedDir, { format: archiveFormat });

    return await installPluginFromLocalSource(extractedDir, {
      force: options.force,
      manifestPath: options.manifestPath,
      installRoot: options.installRoot,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
