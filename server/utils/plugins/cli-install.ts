import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { PluginInstallResult } from '#server/utils/plugins/installer';
import { PluginInstallError } from '#server/utils/plugins/installer';

const execFileAsync = promisify(execFile);
const CLI_INSTALL_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseInstallResultFromStdout(stdout: string): PluginInstallResult | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        continue;
      }

      const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
      const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
      const version = typeof parsed.version === 'string' ? parsed.version.trim() : '';
      const manifestPath = typeof parsed.manifestPath === 'string' ? parsed.manifestPath.trim() : '';
      const sourceDir = typeof parsed.sourceDir === 'string' ? parsed.sourceDir.trim() : '';
      const destinationDir =
        typeof parsed.destinationDir === 'string' ? parsed.destinationDir.trim() : '';
      const replaced = parsed.replaced === true;
      const restartRequired = parsed.restartRequired === true;

      if (!id || !name || !version || !manifestPath || !sourceDir || !destinationDir) {
        continue;
      }

      return {
        id,
        name,
        version,
        manifestPath,
        sourceDir,
        destinationDir,
        replaced,
        restartRequired,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function extractCliErrorMessage(stderr: string, stdout: string, fallback: string): string {
  const errorCandidates = [stderr, stdout]
    .flatMap((stream) => stream.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = errorCandidates.length - 1; index >= 0; index -= 1) {
    const line = errorCandidates[index];
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed) && typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
        return parsed.error.trim();
      }
    } catch {
      continue;
    }
  }

  return fallback;
}

export async function installPluginFromCliSource(
  sourcePath: string,
  options: {
    manifestPath?: string;
    force?: boolean;
  } = {},
): Promise<PluginInstallResult> {
  const cliEntrypoint = resolve(process.cwd(), 'cli', 'index.mjs');
  const args = [cliEntrypoint, 'plugins', 'install', sourcePath, '--json'];

  if (options.manifestPath && options.manifestPath.trim().length > 0) {
    args.push('--manifest', options.manifestPath.trim());
  }

  if (options.force) {
    args.push('--force');
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      maxBuffer: CLI_INSTALL_MAX_BUFFER_BYTES,
      env: process.env,
    });

    const parsed = parseInstallResultFromStdout(stdout);
    if (!parsed) {
      throw new PluginInstallError(
        500,
        'Plugin install command did not return a valid install result payload.',
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof PluginInstallError) {
      throw error;
    }

    const commandError = error as {
      code?: number | string | null;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const statusCode =
      typeof commandError.code === 'number' && commandError.code > 0 && commandError.code < 1000
        ? 400
        : 500;
    const fallbackMessage =
      typeof commandError.message === 'string' && commandError.message.trim().length > 0
        ? commandError.message
        : 'Plugin install command failed.';
    const message = extractCliErrorMessage(
      commandError.stderr ?? '',
      commandError.stdout ?? '',
      fallbackMessage,
    );

    throw new PluginInstallError(statusCode, message);
  }
}
