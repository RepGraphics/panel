import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installPluginFromArchiveBuffer,
  installPluginFromLocalSource,
  PluginInstallError,
} from '../../../server/utils/plugins/installer';

const tempDirs: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'xyra-plugin-installer-'));
  tempDirs.push(root);
  return root;
}

function createPluginSource(
  root: string,
  id = 'acme-tools',
  version = '1.0.0',
  options: { includeNuxtLayer?: boolean; includeModuleEntry?: boolean } = {},
): string {
  const sourceDir = join(root, id);
  const includeNuxtLayer = options.includeNuxtLayer ?? true;
  const includeModuleEntry = options.includeModuleEntry ?? false;

  if (includeNuxtLayer) {
    mkdirSync(join(sourceDir, 'ui'), { recursive: true });
  }

  if (includeModuleEntry) {
    mkdirSync(join(sourceDir, 'modules'), { recursive: true });
    writeFileSync(join(sourceDir, 'modules', 'xyra.ts'), 'export default defineNuxtModule({})', 'utf8');
  }

  const entry: Record<string, string> = {};
  if (includeNuxtLayer) {
    entry.nuxtLayer = './ui';
  }

  if (includeModuleEntry) {
    entry.module = './modules/xyra.ts';
  }

  writeFileSync(
    join(sourceDir, 'plugin.json'),
    JSON.stringify(
      {
        id,
        name: 'Acme Tools',
        version,
        entry,
      },
      null,
      2,
    ),
    'utf8',
  );

  return sourceDir;
}

function isTarAvailable(): boolean {
  try {
    execFileSync('tar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('server/utils/plugins/installer', () => {
  it('installs a plugin from a local source directory', async () => {
    const root = createTempRoot();
    const sourceDir = createPluginSource(root, 'acme-tools');
    const installRoot = join(root, 'extensions');

    const result = await installPluginFromLocalSource(sourceDir, {
      installRoot,
    });

    expect(result.id).toBe('acme-tools');
    expect(result.replaced).toBe(false);
    expect(result.restartRequired).toBe(true);
    expect(existsSync(join(installRoot, 'acme-tools', 'plugin.json'))).toBe(true);
  });

  it('marks restart as required when plugin only defines a Nuxt module entry', async () => {
    const root = createTempRoot();
    const sourceDir = createPluginSource(root, 'module-plugin', '1.0.0', {
      includeNuxtLayer: false,
      includeModuleEntry: true,
    });
    const installRoot = join(root, 'extensions');

    const result = await installPluginFromLocalSource(sourceDir, {
      installRoot,
    });

    expect(result.id).toBe('module-plugin');
    expect(result.restartRequired).toBe(true);
    expect(existsSync(join(installRoot, 'module-plugin', 'modules', 'xyra.ts'))).toBe(true);
  });

  it('rejects duplicate install without force', async () => {
    const root = createTempRoot();
    const sourceDir = createPluginSource(root, 'duplicate-plugin');
    const installRoot = join(root, 'extensions');

    await installPluginFromLocalSource(sourceDir, { installRoot });

    let thrown: unknown;
    try {
      await installPluginFromLocalSource(sourceDir, {
        installRoot,
        force: false,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PluginInstallError);
    expect((thrown as PluginInstallError).statusCode).toBe(409);
  });

  const testArchive = isTarAvailable() ? it : it.skip;

  testArchive('installs a plugin from an uploaded archive buffer', async () => {
    const root = createTempRoot();
    const sourceDir = createPluginSource(root, 'archive-plugin');
    const archivePath = join(root, 'archive-plugin.tar.gz');
    const installRoot = join(root, 'extensions');

    execFileSync('tar', ['-czf', archivePath, '-C', root, 'archive-plugin']);
    const archiveBuffer = readFileSync(archivePath);

    const result = await installPluginFromArchiveBuffer(archiveBuffer, {
      archiveFilename: 'archive-plugin.tar.gz',
      installRoot,
    });

    expect(result.id).toBe('archive-plugin');
    expect(existsSync(join(installRoot, 'archive-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(sourceDir)).toBe(true);
  });
});
