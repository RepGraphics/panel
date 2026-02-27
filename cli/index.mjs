#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { consola } from 'consola';
import { execa } from 'execa';
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'pathe';
import { colors } from 'consola/utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const pluginSystemVersion =
  typeof pkg?.xyra?.pluginSystemVersion === 'string' ? pkg.xyra.pluginSystemVersion.trim() : '';
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

function parseDotEnv(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (!key) {
      continue;
    }

    let value = line.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

async function readProjectDotEnv() {
  const envPath = resolve(projectRoot, '.env');
  try {
    const raw = await readFile(envPath, 'utf8');
    return parseDotEnv(raw);
  } catch {
    return {};
  }
}

const projectDotEnv = await readProjectDotEnv();

function validatePluginManifest(rawManifest, sourcePath) {
  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) {
    throw new Error(`Invalid plugin manifest at ${sourcePath}: expected a JSON object.`);
  }

  const manifest = rawManifest;
  const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
  const name = typeof manifest.name === 'string' ? manifest.name.trim() : '';
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
  const compatibility =
    typeof manifest.compatibility === 'string' ? manifest.compatibility.trim() : '';
  const description = typeof manifest.description === 'string' ? manifest.description.trim() : '';
  const author = typeof manifest.author === 'string' ? manifest.author.trim() : '';
  const website = typeof manifest.website === 'string' ? manifest.website.trim() : '';

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

  if (!compatibility) {
    throw new Error(`Invalid plugin manifest at ${sourcePath}: "compatibility" is required.`);
  }

  if (!description) {
    throw new Error(`Invalid plugin manifest at ${sourcePath}: "description" is required.`);
  }

  if (!author) {
    throw new Error(`Invalid plugin manifest at ${sourcePath}: "author" is required.`);
  }

  if (!website) {
    throw new Error(`Invalid plugin manifest at ${sourcePath}: "website" is required.`);
  }

  if (!pluginSystemVersion) {
    throw new Error('Panel plugin system version is not configured in package.json (xyra.pluginSystemVersion).');
  }

  if (compatibility !== pluginSystemVersion) {
    throw new Error(
      `Plugin compatibility "${compatibility}" does not match panel plugin system version "${pluginSystemVersion}".`,
    );
  }

  return { ...manifest, id, name, version, compatibility, description, author, website };
}

async function setInstalledPluginManifestEnabled(manifestPath) {
  const rawManifest = await readJsonFile(manifestPath);
  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: expected a JSON object.`);
  }

  const nextManifest = {
    ...rawManifest,
    enabled: true,
  };

  await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
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
  const { logError = true, ...execaOptions } = options;
  const command = `${bin} ${args.join(' ')}`;
  logger.start(command);
  try {
    return await execa(bin, args, {
      stdio: 'inherit',
      preferLocal: true,
      cwd: projectRoot,
      ...execaOptions,
    });
  } catch (error) {
    if (logError) {
      logger.error(error);
    }
    throw error;
  }
}

function isMissingBinaryError(error, binary) {
  const text = `${error?.shortMessage ?? ''}\n${error?.stderr ?? ''}\n${error?.message ?? ''}`.toLowerCase();
  const normalizedBinary = binary.toLowerCase();

  return (
    error?.code === 'ENOENT' ||
    text.includes(`'${normalizedBinary}' is not recognized`) ||
    text.includes(`"${normalizedBinary}" is not recognized`) ||
    text.includes(`${normalizedBinary}: command not found`) ||
    text.includes(`command "${normalizedBinary}" not found`) ||
    text.includes(`spawn ${normalizedBinary} enoent`) ||
    text.includes('could not determine executable to run')
  );
}

async function runBinaryWithMirroredOutput(bin, args, options = {}) {
  const { stdio = 'inherit', ...execaOptions } = options;

  if (stdio !== 'inherit') {
    return await execa(bin, args, {
      cwd: projectRoot,
      preferLocal: true,
      stdio,
      ...execaOptions,
    });
  }

  const subprocess = execa(bin, args, {
    cwd: projectRoot,
    preferLocal: true,
    stdio: 'pipe',
    ...execaOptions,
  });

  subprocess.stdout?.pipe(process.stdout);
  subprocess.stderr?.pipe(process.stderr);

  return await subprocess;
}

async function canRunPm2Binary(bin, argsPrefix = []) {
  try {
    await execa(bin, [...argsPrefix, '--version'], {
      cwd: projectRoot,
      preferLocal: true,
      stdio: 'pipe',
    });
    return true;
  } catch (error) {
    if (isMissingBinaryError(error, 'pm2')) {
      return false;
    }

    logger.error(error);
    throw error;
  }
}

async function runPm2Binary(args, options = {}) {
  const command = `pm2 ${args.join(' ')}`;
  logger.start(command);

  const execaOptions = {
    ...options,
    env: {
      ...projectDotEnv,
      ...process.env,
      ...options.env,
    },
  };

  if (await canRunPm2Binary('pm2')) {
    return await runBinaryWithMirroredOutput('pm2', args, execaOptions);
  }

  logger.warn('PM2 is not on PATH, trying `pnpm exec pm2`...');
  if (await canRunPm2Binary('pnpm', ['exec', 'pm2'])) {
    return await runBinaryWithMirroredOutput('pnpm', ['exec', 'pm2', ...args], execaOptions);
  }

  logger.warn('PM2 is not installed locally, trying `pnpm dlx pm2`...');
  try {
    return await runBinaryWithMirroredOutput('pnpm', ['dlx', 'pm2', ...args], execaOptions);
  } catch (error) {
    logger.error(error);
    throw error;
  }
}

function formatRuntimeValue(value) {
  if (value === undefined || value === null) {
    return colors.dim('(unset)');
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : colors.dim('(empty)');
}

function logPm2StartContext({ ecosystemPath, envName, processName }) {
  const runtimeEnv = {
    ...projectDotEnv,
    ...process.env,
  };

  const keys = [
    'PUBLIC_APP_URL',
    'NUXT_PUBLIC_APP_URL',
    'APP_URL',
    'NODE_ENV',
    'HOST',
    'PORT',
    'NITRO_HOST',
    'NITRO_PORT',
    'PM2_LOG_DIR',
  ];

  const lines = [
    accentSoft('PM2 start context'),
    `  process      ${colors.gray('•')} ${formatRuntimeValue(processName)}`,
    `  env block    ${colors.gray('•')} ${formatRuntimeValue(envName)}`,
    `  ecosystem    ${colors.gray('•')} ${formatRuntimeValue(ecosystemPath)}`,
    ...keys.map(
      (key) => `  ${key.padEnd(12)} ${colors.gray('•')} ${formatRuntimeValue(runtimeEnv[key])}`,
    ),
  ];

  logger.info(`\n${lines.join('\n')}`);
}

function createPm2Command(name, description, args, buildArgs) {
  return defineCommand({
    meta: { name, description },
    args,
    run: async (ctx) => {
      const cliArgs = await buildArgs(ctx.args);
      await runPm2Binary(cliArgs);
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

function parseListArg(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  return value
    .split(/[\n,;]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const pluginsInstallCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Install a plugin from a local folder or git repository',
  },
  args: {
    source: {
      type: 'positional',
      required: false,
      description: 'Local path or git URL (single source)',
    },
    sources: {
      type: 'string',
      default: '',
      description: 'Comma/newline-separated list of local paths or git URLs',
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
    'no-restart': {
      type: 'boolean',
      default: false,
      description: 'Skip PM2 stop/start after build (install + build only)',
    },
    json: {
      type: 'boolean',
      default: false,
      description: 'Print machine-readable install result JSON',
    },
  },
  run: async ({ args }) => {
    const jsonOutput = Boolean(args.json);
    const skipPm2Restart = Boolean(args['no-restart']);

    const log = (level, message) => {
      if (jsonOutput) {
        return;
      }
      logger[level](message);
    };

    const fail = (message) => {
      if (jsonOutput) {
        process.stderr.write(`${JSON.stringify({ error: message })}\n`);
      } else {
        logger.error(message);
      }
      process.exit(1);
    };

    const sourceInput = String(args.source || '').trim();
    const sourceInputs = Array.from(
      new Set([sourceInput, ...parseListArg(String(args.sources || ''))].filter(Boolean)),
    );

    if (sourceInputs.length === 0) {
      fail('At least one source is required. Example: xyra plugins install https://github.com/acme/plugin');
    }

    const installResults = [];

    try {
      for (const nextSourceInput of sourceInputs) {
        let sourceRoot = '';
        let tempCloneRoot = '';
        let cloned = false;
        let replaced = false;
        let finalInstallResult = null;

        try {
          const localCandidate = isAbsolute(nextSourceInput)
            ? nextSourceInput
            : resolve(process.cwd(), nextSourceInput);

          if (await isDirectory(localCandidate)) {
            sourceRoot = localCandidate;
          } else if (looksLikeGitSource(nextSourceInput)) {
            cloned = true;
            tempCloneRoot = await cloneSourceToTemp(nextSourceInput, String(args.branch || ''));
            sourceRoot = tempCloneRoot;
          } else {
            throw new Error(
              `Source not found as directory: ${localCandidate}\nIf this is a repository, pass a full git URL.`,
            );
          }

          const pluginSourceDir = await resolvePluginSourceDirectory(
            sourceRoot,
            String(args.manifest || ''),
          );
          const manifestPath = join(pluginSourceDir, pluginManifestFile);
          const manifest = validatePluginManifest(await readJsonFile(manifestPath), manifestPath);
          const restartRequired = Boolean(
            (typeof manifest.entry?.nuxtLayer === 'string' && manifest.entry.nuxtLayer.trim()) ||
              (typeof manifest.entry?.module === 'string' && manifest.entry.module.trim()),
          );

          await ensureDirectory(extensionsRoot);
          const destinationDir = join(extensionsRoot, manifest.id);

          const sourceResolved = resolve(pluginSourceDir);
          const destinationResolved = resolve(destinationDir);

          const installResult = {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            manifestPath,
            sourceDir: pluginSourceDir,
            destinationDir,
            replaced: false,
            restartRequired,
          };

          if (sourceResolved === destinationResolved) {
            await setInstalledPluginManifestEnabled(manifestPath);
            finalInstallResult = installResult;
          } else {
            if (await pathExists(destinationDir)) {
              if (!args.force) {
                const destinationManifestPath = join(destinationDir, pluginManifestFile);
                const destinationHasManifest = await pathExists(destinationManifestPath);

                if (destinationHasManifest) {
                  throw new Error(
                    `Plugin directory already exists: ${destinationDir}. Use --force to overwrite.`,
                  );
                }

                log(
                  'warn',
                  `Destination exists without ${pluginManifestFile}; replacing stale directory: ${destinationDir}`,
                );
                await rm(destinationDir, { recursive: true, force: true });
                replaced = true;
              } else {
                log('warn', `Removing existing plugin directory: ${destinationDir}`);
                await rm(destinationDir, { recursive: true, force: true });
                replaced = true;
              }
            }

            log('start', `Installing plugin "${manifest.name}" (${manifest.id}@${manifest.version})`);
            await cp(pluginSourceDir, destinationDir, { recursive: true });
            await setInstalledPluginManifestEnabled(join(destinationDir, pluginManifestFile));

            finalInstallResult = {
              ...installResult,
              replaced,
            };
          }

          if (!finalInstallResult) {
            throw new Error('Plugin install did not produce a result payload.');
          }

          installResults.push(finalInstallResult);

          if (!jsonOutput) {
            if (sourceResolved === destinationResolved) {
              logger.success(
                `Plugin "${manifest.name}" (${manifest.id}@${manifest.version}) is already installed at ${destinationDir}`,
              );
            } else {
              logger.success(`Installed to ${destinationDir}`);
            }
          }
        } finally {
          if (cloned && tempCloneRoot && !args['keep-temp']) {
            await rm(tempCloneRoot, { recursive: true, force: true });
          }
        }
      }

      if (jsonOutput) {
        if (installResults.length === 1) {
          process.stdout.write(`${JSON.stringify(installResults[0])}\n`);
        } else {
          process.stdout.write(`${JSON.stringify({ results: installResults })}\n`);
        }
        return;
      }

      logger.start('Running pnpm run build...');
      await runBinary('pnpm', ['run', 'build'], { logError: false });

      if (skipPm2Restart) {
        logger.success('Build finished. PM2 restart skipped (--no-restart).');
        logger.success(
          `Plugin install flow complete: ${installResults.length} plugin(s) installed and built.`,
        );
        return;
      }

      logger.success('Build finished. Restarting PM2 process...');

      const processName = defaultPm2App;
      const ecosystemPath = resolvePath(defaultEcosystemFile);
      await ensureFile(ecosystemPath);

      try {
        await runPm2Binary(['stop', processName]);
      } catch (error) {
        logger.warn(`PM2 stop skipped: ${error instanceof Error ? error.message : String(error)}`);
      }

      await runPm2Binary([
        'start',
        ecosystemPath,
        '--env',
        'production',
        '--only',
        processName,
        '--update-env',
      ]);

      logger.success(
        `Plugin install flow complete: ${installResults.length} plugin(s) installed, built, and PM2 restarted.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(message);
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
      required: false,
      description: 'Plugin id (single id)',
    },
    ids: {
      type: 'string',
      default: '',
      description: 'Comma/newline-separated list of plugin ids',
    },
  },
  run: async ({ args }) => {
    const ids = Array.from(
      new Set([String(args.id || '').trim(), ...parseListArg(String(args.ids || ''))].filter(Boolean)),
    );

    if (ids.length === 0) {
      logger.error('Plugin id is required. Example: xyra plugins remove acme-tools');
      process.exit(1);
    }

    let removedCount = 0;

    for (const id of ids) {
      const targetDir = join(extensionsRoot, id);
      if (!(await pathExists(targetDir))) {
        logger.warn(`Plugin is not installed: ${id}`);
        continue;
      }

      await rm(targetDir, { recursive: true, force: true });
      removedCount += 1;
      logger.success(`Removed plugin "${id}"`);
    }

    if (removedCount === 0) {
      logger.info('No plugins were removed.');
      return;
    }

    logger.info('Run `pnpm run build` to apply plugin Nuxt layer/module changes.');
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
      await runPm2Binary(['reload', processName, '--env', args.env, '--update-env']);
      logger.success('Reloaded existing PM2 process');
    } catch (error) {
      logger.warn('Reload failed, attempting clean start');
      logger.debug(error);
      await runPm2Binary([
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
    logPm2StartContext({
      ecosystemPath,
      envName: args.env,
      processName: args.name,
    });
    return ['start', ecosystemPath, '--env', args.env, '--only', args.name, '--update-env'];
  },
);

const pm2ReloadCommand = createPm2Command(
  'reload',
  'Reload the running PM2 process',
  { env: envArg, name: nameArg, ecosystem: ecosystemArg },
  async (args) => {
    const ecosystemPath = resolvePath(args.ecosystem);
    await ensureFile(ecosystemPath);
    return ['reload', ecosystemPath, '--only', args.name, '--env', args.env, '--update-env'];
  },
);

const pm2RestartCommand = createPm2Command(
  'restart',
  'Restart the PM2 process',
  { env: envArg, name: nameArg, ecosystem: ecosystemArg },
  async (args) => {
    const ecosystemPath = resolvePath(args.ecosystem);
    await ensureFile(ecosystemPath);
    return ['restart', ecosystemPath, '--only', args.name, '--env', args.env, '--update-env'];
  },
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
      type: 'string',
      default: '50',
      description: 'How many lines to show before tailing',
    },
    timestamp: {
      type: 'boolean',
      default: false,
      description: 'Show timestamps for each log line',
    },
  },
  (args) => {
    const processName = String(args.name || defaultPm2App);
    const parsedLines =
      typeof args.lines === 'number'
        ? args.lines
        : typeof args.lines === 'string'
          ? Number.parseInt(args.lines, 10)
          : Number.NaN;
    const lines = Number.isFinite(parsedLines) && parsedLines > 0 ? Math.trunc(parsedLines) : 50;
    const logArgs = ['logs', processName, '--lines', String(lines)];
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
    const { stdout } = await runPm2Binary(pm2Args, { stdio: 'pipe' });

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
