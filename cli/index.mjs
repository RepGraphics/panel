#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { consola } from 'consola';
import { execa } from 'execa';
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'pathe';
import { colors } from 'consola/utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const logger = consola.withDefaults({
  tag: 'xyra',
  fancy: process.stdout.isTTY,
  formatOptions: { compact: true },
});
const defaultEcosystemFile = 'ecosystem.config.cjs';
const defaultPm2App = 'xyrapanel';
const pluginManifestFile = 'plugin.json';
const extensionsRoot = resolve(projectRoot, 'extensions');
const accent = colors.redBright;
const accentSoft = colors.red;
const divider = colors.dim('─'.repeat(58));

const coreCommandSummaries = [
  ['deploy', 'Build and reload/start via PM2'],
  ['pm2', 'Process controls (start/reload/logs)'],
  ['build', 'Nuxt build for Nitro output'],
  ['plugins', 'Install/list/remove plugin packages'],
];

const toolingCommandSummaries = [
  ['nuxt dev', 'Nuxt dev server with HMR'],
  ['lint', 'oxlint suite (fix/type-aware)'],
  ['fmt', 'oxfmt formatters'],
  ['test', 'Vitest run/watch/coverage'],
  ['db', 'Drizzle schema helpers'],
  ['pwa', 'PWA asset generation'],
];

const formatCommandList = (entries) => {
  const longest = entries.reduce((max, [label]) => Math.max(max, label.length), 0) + 2;
  return entries
    .map(
      ([label, description]) =>
        `  ${accent(label.padEnd(longest))}${colors.gray('•')} ${description}`,
    )
    .join('\n');
};

const renderRootHelp = () =>
  [
    `${accent('██╗  ██╗ ██╗   ██╗ ██████╗  █████╗ ██████╗  █████╗ ███╗   ██╗███████╗██╗')} ${colors.dim(`v${pkg.version}`)}`,
    `${accent('╚██╗██╔╝ ╚██╗ ██╔╝ ██╔══██╗██╔══██╗██╔══██╗██╔══██╗████╗  ██║██╔════╝██║')} ${colors.dim('by @26bz & contributors')}`,
    accent(' ╚███╔╝   ╚████╔╝  ██████╔╝███████║██████╔╝███████║██╔██╗ ██║█████╗  ██║'),
    accent(' ██╔██╗    ╚██╔╝   ██╔══██╗██╔══██║██╔═══╝ ██╔══██║██║╚██╗██║██╔══╝  ██║'),
    accent('██╔╝ ██╗    ██║    ██║  ██║██║  ██║██║     ██║  ██║██║ ╚████║███████╗███████╗'),
    accent('╚═╝  ╚═╝    ╚═╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝'),
    divider,
    `${accentSoft('Usage')}\n  ${colors.white('xyra <command> [options]')}`,
    '',
    accentSoft('Core workflows'),
    formatCommandList(coreCommandSummaries),
    '',
    accentSoft('Nuxt & tooling'),
    formatCommandList(toolingCommandSummaries),
    '',
    colors.dim('Tip: run `pnpm link --global` to expose xyra everywhere on your VPS.'),
  ].join('\n');

const envArg = {
  type: 'string',
  default: 'production',
  description: 'PM2 environment block to use (env or env_production)',
};

const nameArg = {
  type: 'string',
  default: defaultPm2App,
  description: 'PM2 process name to target',
};

const ecosystemArg = {
  type: 'string',
  default: defaultEcosystemFile,
  description: 'Path to a PM2 ecosystem config (relative to the repo root)',
};

const resolvePath = (maybeRelative) =>
  isAbsolute(maybeRelative) ? maybeRelative : resolve(projectRoot, maybeRelative);

async function ensureFile(path) {
  try {
    await access(path);
  } catch {
    logger.error(`Cannot find ecosystem config at: ${path}`);
    process.exit(1);
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    const result = await stat(path);
    return result.isDirectory();
  } catch {
    return false;
  }
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

async function readJsonFile(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

function validatePluginManifest(rawManifest, sourcePath) {
  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) {
    throw new Error(`Invalid plugin manifest at ${sourcePath}: expected a JSON object.`);
  }

  const manifest = rawManifest;
  const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
  const name = typeof manifest.name === 'string' ? manifest.name.trim() : '';
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';

  if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(
      `Invalid plugin id in ${sourcePath}. Expected /^[a-z0-9][a-z0-9._-]*$/ and non-empty.`,
    );
  }

  if (!name) {
    throw new Error(`Invalid plugin manifest at ${sourcePath}: "name" is required.`);
  }

  if (!version) {
    throw new Error(`Invalid plugin manifest at ${sourcePath}: "version" is required.`);
  }

  return { ...manifest, id, name, version };
}

function looksLikeGitSource(source) {
  return (
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('ssh://') ||
    source.startsWith('git@') ||
    source.endsWith('.git') ||
    source.includes('github.com/') ||
    source.includes('gitlab.com/')
  );
}

async function cloneSourceToTemp(source, branch = '') {
  const prefix = join(tmpdir(), 'xyra-plugin-');
  const targetDir = await mkdtemp(prefix);

  const args = ['clone', '--depth', '1'];
  if (branch && String(branch).trim()) {
    args.push('--branch', String(branch).trim());
  }
  args.push(source, targetDir);

  await runBinary('git', args);
  return targetDir;
}

async function resolvePluginSourceDirectory(sourceRoot, manifestPath = '') {
  const normalizedManifestPath = String(manifestPath || '').trim();
  if (normalizedManifestPath) {
    const candidate = isAbsolute(normalizedManifestPath)
      ? normalizedManifestPath
      : resolve(sourceRoot, normalizedManifestPath);
    const maybeManifestPath = candidate.endsWith(pluginManifestFile)
      ? candidate
      : join(candidate, pluginManifestFile);

    if (!(await pathExists(maybeManifestPath))) {
      throw new Error(
        `Cannot find ${pluginManifestFile} at: ${maybeManifestPath}. ` +
          `Use --manifest to point to the plugin folder or manifest file.`,
      );
    }

    return dirname(maybeManifestPath);
  }

  /** @type {Set<string>} */
  const candidates = new Set();
  const maybeAddCandidate = async (dirPath) => {
    const candidateManifestPath = join(dirPath, pluginManifestFile);
    if (await pathExists(candidateManifestPath)) {
      candidates.add(resolve(dirPath));
    }
  };

  await maybeAddCandidate(sourceRoot);

  const firstLevel = await readdir(sourceRoot, { withFileTypes: true });
  for (const first of firstLevel) {
    if (!first.isDirectory()) continue;
    if (['.git', 'node_modules', '.nuxt', '.output'].includes(first.name)) continue;

    const firstPath = join(sourceRoot, first.name);
    await maybeAddCandidate(firstPath);

    const secondLevel = await readdir(firstPath, { withFileTypes: true });
    for (const second of secondLevel) {
      if (!second.isDirectory()) continue;
      if (['.git', 'node_modules', '.nuxt', '.output'].includes(second.name)) continue;

      await maybeAddCandidate(join(firstPath, second.name));
    }
  }

  const resolvedCandidates = Array.from(candidates);

  if (resolvedCandidates.length === 0) {
    throw new Error(
      `No ${pluginManifestFile} found in source: ${sourceRoot}. ` +
        `Provide --manifest if the plugin lives in a nested directory.`,
    );
  }

  if (resolvedCandidates.length > 1) {
    throw new Error(
      `Multiple plugin manifests found:\n` +
        resolvedCandidates.map((candidate) => `- ${candidate}`).join('\n') +
        `\nUse --manifest to select one.`,
    );
  }

  return resolvedCandidates[0];
}

async function collectInstalledPlugins() {
  if (!(await isDirectory(extensionsRoot))) {
    return { installed: [], invalid: [] };
  }

  const entries = await readdir(extensionsRoot, { withFileTypes: true });
  const installed = [];
  const invalid = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = join(extensionsRoot, entry.name);
    const manifestPath = join(pluginDir, pluginManifestFile);
    if (!(await pathExists(manifestPath))) continue;

    try {
      const rawManifest = await readJsonFile(manifestPath);
      const manifest = validatePluginManifest(rawManifest, manifestPath);
      const enabled = manifest.enabled !== false;
      installed.push({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        enabled,
        path: pluginDir,
      });
    } catch (error) {
      invalid.push({
        path: manifestPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  installed.sort((a, b) => a.id.localeCompare(b.id));
  invalid.sort((a, b) => a.path.localeCompare(b.path));
  return { installed, invalid };
}

async function runBinary(bin, args, options = {}) {
  const command = `${bin} ${args.join(' ')}`;
  logger.start(command);
  try {
    return await execa(bin, args, {
      stdio: 'inherit',
      preferLocal: true,
      cwd: projectRoot,
      ...options,
    });
  } catch (error) {
    logger.error(error);
    throw error;
  }
}

function createPm2Command(name, description, args, buildArgs) {
  return defineCommand({
    meta: { name, description },
    args,
    run: async (ctx) => {
      const cliArgs = await buildArgs(ctx.args);
      await runBinary('pm2', cliArgs);
    },
  });
}

const runPnpmScript = (script, extraArgs = []) => runBinary('pnpm', ['run', script, ...extraArgs]);

const createPnpmCommand = (name, description, script) =>
  defineCommand({
    meta: { name, description },
    run: async () => {
      await runPnpmScript(script);
    },
  });

const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description: 'Run pnpm build to produce the Nitro output',
  },
  run: async () => {
    await runBinary('pnpm', ['run', 'build']);
  },
});

const nuxtCommand = defineCommand({
  meta: {
    name: 'nuxt',
    description: 'Nuxt runtime helpers (dev, preview, generate)',
  },
  subCommands: {
    dev: createPnpmCommand('dev', 'Start Nuxt dev server with HMR', 'dev'),
    preview: createPnpmCommand('preview', 'Preview the production build', 'preview'),
    generate: createPnpmCommand('generate', 'Generate static site output', 'generate'),
  },
});

const lintCommand = defineCommand({
  meta: {
    name: 'lint',
    description: 'Run oxlint checks (optionally fix/type-aware)',
  },
  run: async () => {
    await runPnpmScript('lint');
  },
  subCommands: {
    fix: createPnpmCommand('fix', 'Run oxlint --fix', 'lint:fix'),
    'type-aware': createPnpmCommand('type-aware', 'Type-aware linting', 'lint:type-aware'),
    'type-check': createPnpmCommand(
      'type-check',
      'Type-aware lint + type-check',
      'lint:type-check',
    ),
  },
});

const fmtCommand = defineCommand({
  meta: {
    name: 'fmt',
    description: 'Format codebase with oxfmt',
  },
  run: async () => {
    await runPnpmScript('fmt');
  },
  subCommands: {
    check: createPnpmCommand('check', 'Verify formatting without writing', 'fmt:check'),
  },
});

const testCommand = defineCommand({
  meta: {
    name: 'test',
    description: 'Vitest runners (watch / coverage)',
  },
  run: async () => {
    await runPnpmScript('test');
  },
  subCommands: {
    watch: createPnpmCommand('watch', 'Run Vitest in watch mode', 'test:watch'),
    coverage: createPnpmCommand('coverage', 'Run Vitest with coverage enabled', 'test:coverage'),
  },
});

const dbCommand = defineCommand({
  meta: {
    name: 'db',
    description: 'Drizzle schema migrations',
  },
  subCommands: {
    generate: createPnpmCommand('generate', 'Generate new Drizzle migrations', 'db:generate'),
    push: createPnpmCommand('push', 'Push schema to database', 'db:push'),
  },
});

const pwaCommand = createPnpmCommand('pwa', 'Generate PWA assets', 'generate-pwa-assets');

const pluginsListCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List installed plugins from extensions/*/plugin.json',
  },
  run: async () => {
    const { installed, invalid } = await collectInstalledPlugins();

    if (installed.length === 0) {
      logger.info(`No plugins found in ${extensionsRoot}`);
    } else {
      const idWidth = Math.max(...installed.map((plugin) => plugin.id.length), 2) + 2;
      const versionWidth = Math.max(...installed.map((plugin) => plugin.version.length), 7) + 2;
      const enabledWidth = 10;

      const header =
        accent('ID'.padEnd(idWidth)) +
        accent('VERSION'.padEnd(versionWidth)) +
        accent('ENABLED'.padEnd(enabledWidth)) +
        accent('PATH');
      console.log(header);

      for (const plugin of installed) {
        const enabledLabel = plugin.enabled ? 'yes' : 'no';
        console.log(
          plugin.id.padEnd(idWidth) +
            plugin.version.padEnd(versionWidth) +
            enabledLabel.padEnd(enabledWidth) +
            plugin.path,
        );
      }
    }

    if (invalid.length > 0) {
      logger.warn('Some plugin manifests could not be parsed:');
      for (const entry of invalid) {
        logger.warn(`- ${entry.path}: ${entry.error}`);
      }
    }
  },
});

const pluginsInstallCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Install a plugin from a local folder or git repository',
  },
  args: {
    source: {
      type: 'positional',
      required: true,
      description: 'Local path or git URL',
    },
    branch: {
      type: 'string',
      default: '',
      description: 'Git branch/tag to clone from when source is a repository',
    },
    manifest: {
      type: 'string',
      default: '',
      description: 'Path to plugin folder or plugin.json within the source',
    },
    force: {
      type: 'boolean',
      default: false,
      description: 'Overwrite existing plugin directory if it already exists',
    },
    'keep-temp': {
      type: 'boolean',
      default: false,
      description: 'Keep temporary cloned source on disk (debugging only)',
    },
  },
  run: async ({ args }) => {
    const sourceInput = String(args.source || '').trim();
    if (!sourceInput) {
      logger.error('A source is required. Example: xyra plugins install https://github.com/acme/plugin');
      process.exit(1);
    }

    let sourceRoot = '';
    let tempCloneRoot = '';
    let cloned = false;

    try {
      const localCandidate = isAbsolute(sourceInput)
        ? sourceInput
        : resolve(process.cwd(), sourceInput);

      if (await isDirectory(localCandidate)) {
        sourceRoot = localCandidate;
      } else if (looksLikeGitSource(sourceInput)) {
        cloned = true;
        tempCloneRoot = await cloneSourceToTemp(sourceInput, String(args.branch || ''));
        sourceRoot = tempCloneRoot;
      } else {
        logger.error(`Source not found as directory: ${localCandidate}`);
        logger.error('If this is a repository, pass a full git URL.');
        process.exit(1);
      }

      const pluginSourceDir = await resolvePluginSourceDirectory(sourceRoot, String(args.manifest || ''));
      const manifestPath = join(pluginSourceDir, pluginManifestFile);
      const manifest = validatePluginManifest(await readJsonFile(manifestPath), manifestPath);

      await ensureDirectory(extensionsRoot);
      const destinationDir = join(extensionsRoot, manifest.id);

      const sourceResolved = resolve(pluginSourceDir);
      const destinationResolved = resolve(destinationDir);

      if (sourceResolved === destinationResolved) {
        logger.success(
          `Plugin "${manifest.name}" (${manifest.id}@${manifest.version}) is already installed at ${destinationDir}`,
        );
        return;
      }

      if (await pathExists(destinationDir)) {
        if (!args.force) {
          const destinationManifestPath = join(destinationDir, pluginManifestFile);
          const destinationHasManifest = await pathExists(destinationManifestPath);

          if (destinationHasManifest) {
            logger.error(
              `Plugin directory already exists: ${destinationDir}. ` +
                `Use --force to overwrite.`,
            );
            process.exit(1);
          }

          logger.warn(
            `Destination exists without ${pluginManifestFile}; replacing stale directory: ${destinationDir}`,
          );
          await rm(destinationDir, { recursive: true, force: true });
        } else {
          logger.warn(`Removing existing plugin directory: ${destinationDir}`);
          await rm(destinationDir, { recursive: true, force: true });
        }
      }

      logger.start(`Installing plugin "${manifest.name}" (${manifest.id}@${manifest.version})`);
      await cp(pluginSourceDir, destinationDir, { recursive: true });
      logger.success(`Installed to ${destinationDir}`);
      logger.info('Restart your panel dev/build process so Nuxt layer changes are applied.');
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      if (cloned && tempCloneRoot && !args['keep-temp']) {
        await rm(tempCloneRoot, { recursive: true, force: true });
      }
    }
  },
});

const pluginsRemoveCommand = defineCommand({
  meta: {
    name: 'remove',
    description: 'Remove an installed plugin by id',
  },
  args: {
    id: {
      type: 'positional',
      required: true,
      description: 'Plugin id (directory name under extensions)',
    },
  },
  run: async ({ args }) => {
    const id = String(args.id || '').trim();
    if (!id) {
      logger.error('Plugin id is required. Example: xyra plugins remove acme-tools');
      process.exit(1);
    }

    const targetDir = join(extensionsRoot, id);
    if (!(await pathExists(targetDir))) {
      logger.warn(`Plugin is not installed: ${id}`);
      return;
    }

    await rm(targetDir, { recursive: true, force: true });
    logger.success(`Removed plugin "${id}"`);
    logger.info('Restart your panel dev/build process so Nuxt layer changes are applied.');
  },
});

const pluginsCommand = defineCommand({
  meta: {
    name: 'plugins',
    description: 'Manage Xyra plugins',
  },
  subCommands: {
    list: pluginsListCommand,
    install: pluginsInstallCommand,
    remove: pluginsRemoveCommand,
  },
});

const deployCommand = defineCommand({
  meta: {
    name: 'deploy',
    description: 'Build the app and reload/start it through PM2',
  },
  args: {
    env: envArg,
    name: nameArg,
    ecosystem: ecosystemArg,
    skipBuild: {
      type: 'boolean',
      default: false,
      description: 'Skip the pnpm build step (useful when artifacts already exist)',
    },
  },
  run: async ({ args }) => {
    const ecosystemPath = resolvePath(args.ecosystem);
    await ensureFile(ecosystemPath);

    if (!args.skipBuild) {
      await runBinary('pnpm', ['run', 'build']);
    }

    const processName = String(args.name ?? '');
    logger.start(`Reloading PM2 process: ${processName}`);
    try {
      await runBinary('pm2', ['reload', processName, '--env', args.env, '--update-env']);
      logger.success('Reloaded existing PM2 process');
    } catch (error) {
      logger.warn('Reload failed, attempting clean start');
      logger.debug(error);
      await runBinary('pm2', [
        'start',
        ecosystemPath,
        '--env',
        args.env,
        '--only',
        processName,
        '--update-env',
      ]);
      logger.success('PM2 process started');
    }
  },
});

const pm2StartCommand = createPm2Command(
  'start',
  'Start PM2 using the ecosystem config',
  { env: envArg, name: nameArg, ecosystem: ecosystemArg },
  async (args) => {
    const ecosystemPath = resolvePath(args.ecosystem);
    await ensureFile(ecosystemPath);
    return ['start', ecosystemPath, '--env', args.env, '--only', args.name, '--update-env'];
  },
);

const pm2ReloadCommand = createPm2Command(
  'reload',
  'Reload the running PM2 process',
  { env: envArg, name: nameArg },
  (args) => ['reload', args.name, '--env', args.env, '--update-env'],
);

const pm2RestartCommand = createPm2Command(
  'restart',
  'Restart the PM2 process',
  { env: envArg, name: nameArg },
  (args) => ['restart', args.name, '--env', args.env, '--update-env'],
);

const pm2StopCommand = createPm2Command(
  'stop',
  'Stop the PM2 process',
  { name: nameArg },
  (args) => ['stop', args.name],
);

const pm2DeleteCommand = createPm2Command(
  'delete',
  'Delete the PM2 process and its metadata',
  { name: nameArg },
  (args) => ['delete', args.name],
);

const pm2StatusCommand = createPm2Command(
  'status',
  'Show the PM2 status table',
  {
    name: {
      type: 'string',
      description: 'Optionally filter to a single process name',
      default: '',
    },
  },
  (args) => (args.name ? ['status', args.name] : ['status']),
);

const pm2LogsCommand = createPm2Command(
  'logs',
  'Tail PM2 logs for the process',
  {
    name: nameArg,
    lines: {
      type: 'number',
      default: 50,
      description: 'How many lines to show before tailing',
    },
    timestamp: {
      type: 'boolean',
      default: false,
      description: 'Show timestamps for each log line',
    },
  },
  (args) => {
    const logArgs = ['logs', args.name, '--lines', String(args.lines)];
    if (args.timestamp) {
      logArgs.push('--timestamp');
    }
    return logArgs;
  },
);

const PASTE_SERVICE_URL = 'https://paste.xyrapanel.com/api/pastes';

const pm2PasteLogsCommand = defineCommand({
  meta: {
    name: 'paste-logs',
    description: 'Upload recent PM2 logs to the paste service',
  },
  args: {
    name: nameArg,
    lines: {
      type: 'number',
      default: 400,
      description: 'Lines to pull from PM2 logs',
    },
    stream: {
      type: 'string',
      default: 'both',
      description: 'Select which stream to include: both | out | err',
    },
    source: {
      type: 'string',
      description: 'Optional host label to annotate the paste (e.g. node-04)',
      default: '',
    },
    expires: {
      type: 'string',
      default: '1d',
      description: 'Paste expiration (e.g. 10m, 1h, 6h, 1d, 7d, never)',
    },
  },
  run: async ({ args }) => {
    const pasteUrl = PASTE_SERVICE_URL;

    const processName = String(args.name || defaultPm2App);
    const pm2Args = ['logs', processName, '--lines', String(args.lines), '--nostream'];
    logger.start(`Collecting PM2 logs for ${processName}`);
    const { stdout } = await execa('pm2', pm2Args, { cwd: projectRoot });

    const filtered = (() => {
      if (args.stream === 'out') return stdout.replace(/\n\[.*?\]\s*err.*?(?=\n\[|$)/gms, '');
      if (args.stream === 'err') return stdout.replace(/\n\[.*?\]\s*out.*?(?=\n\[|$)/gms, '');
      return stdout;
    })();

    const maxBytes = 256 * 1024;
    const bodyContent = filtered.length > maxBytes ? filtered.slice(-maxBytes) : filtered;

    const expiresMap = {
      '10m': 10,
      '1h': 60,
      '6h': 360,
      '1d': 1440,
      '7d': 10080,
      never: null,
    };
    const expiresInMinutes = expiresMap[args.expires] ?? expiresMap['1d'];

    const payload = {
      content: bodyContent,
      source: args.source || undefined,
      expiresInMinutes,
    };

    logger.start(`Uploading logs to paste service: ${pasteUrl}`);
    const response = await fetch(pasteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const resultText = await response.text();
    if (!response.ok) {
      logger.error(`Paste upload failed (${response.status}): ${resultText}`);
      process.exit(1);
    }

    try {
      const json = JSON.parse(resultText);
      logger.success('Paste created');
      console.log(json.url || resultText.trim());
    } catch {
      logger.success('Paste created');
      console.log(resultText.trim());
    }
  },
});

const pm2Command = defineCommand({
  meta: {
    name: 'pm2',
    description: 'PM2 helpers for the XyraPanel deployment',
  },
  subCommands: {
    start: pm2StartCommand,
    reload: pm2ReloadCommand,
    restart: pm2RestartCommand,
    stop: pm2StopCommand,
    delete: pm2DeleteCommand,
    status: pm2StatusCommand,
    logs: pm2LogsCommand,
    'paste-logs': pm2PasteLogsCommand,
  },
});

const rootCommand = defineCommand({
  meta: {
    name: 'xyra',
    version: pkg.version,
    description: 'Xyra CLI',
  },
  subCommands: {
    build: buildCommand,
    deploy: deployCommand,
    pm2: pm2Command,
    nuxt: nuxtCommand,
    lint: lintCommand,
    fmt: fmtCommand,
    test: testCommand,
    db: dbCommand,
    pwa: pwaCommand,
    plugins: pluginsCommand,
  },
});

const userArgs = process.argv.slice(2);
const wantsRootHelp =
  userArgs.length === 0 || (userArgs.length === 1 && ['--help', '-h'].includes(userArgs[0]));

if (wantsRootHelp) {
  console.log(renderRootHelp());
  process.exit(0);
}

await runMain(rootCommand);
