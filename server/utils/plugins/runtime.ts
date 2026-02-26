import { pathToFileURL } from 'node:url';
import { discoverPlugins, isPluginEnabled } from '#shared/plugins/discovery';
import type { ResolvedPluginManifest } from '#shared/plugins/types';
import type {
  PluginClientContributions,
  PluginNavigationContribution,
  PluginRuntimeSummary,
  PluginRuntimeSummaryItem,
  PluginUiSlotContribution,
} from '#shared/types/plugins';
import type {
  XyraPluginContext,
  XyraPluginHookHandler,
  XyraPluginLogger,
  XyraServerPlugin,
  XyraServerPluginObject,
} from '#server/utils/plugins/types';
import { applyPluginSqlMigrations } from '#server/utils/plugins/migrations';

interface RuntimePluginState {
  manifest: ResolvedPluginManifest;
  enabled: boolean;
  loaded: boolean;
  errors: string[];
  hooks: Set<string>;
}

interface HookRegistration {
  pluginId: string;
  handler: XyraPluginHookHandler;
  context: XyraPluginContext;
}

const runtimeState: {
  initialized: boolean;
  nitroApp: unknown;
  plugins: Map<string, RuntimePluginState>;
  hookHandlers: Map<string, HookRegistration[]>;
  discoveryErrors: PluginRuntimeSummary['discoveryErrors'];
} = {
  initialized: false,
  nitroApp: null,
  plugins: new Map(),
  hookHandlers: new Map(),
  discoveryErrors: [],
};

function clearRuntimeState({ clearNitroApp = false }: { clearNitroApp?: boolean } = {}): void {
  runtimeState.initialized = false;
  runtimeState.plugins.clear();
  runtimeState.hookHandlers.clear();
  runtimeState.discoveryErrors = [];
  if (clearNitroApp) {
    runtimeState.nitroApp = null;
  }
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createPluginLogger(pluginId: string): XyraPluginLogger {
  return {
    info: (message, ...args) => console.info(`[plugins:${pluginId}] ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[plugins:${pluginId}] ${message}`, ...args),
    error: (message, ...args) => console.error(`[plugins:${pluginId}] ${message}`, ...args),
    debug: (message, ...args) => {
      if (process.env.DEBUG === 'true') {
        console.debug(`[plugins:${pluginId}] ${message}`, ...args);
      }
    },
  };
}

function isPluginObject(value: unknown): value is XyraServerPluginObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeImportedPlugin(moduleValue: unknown): XyraServerPlugin | null {
  const candidate =
    isPluginObject(moduleValue) && 'default' in moduleValue
      ? (moduleValue as { default?: unknown }).default
      : moduleValue;

  if (typeof candidate === 'function') {
    return candidate as XyraServerPlugin;
  }

  if (!isPluginObject(candidate)) {
    return null;
  }

  const hasSetup = typeof candidate.setup === 'function';
  const hasHooks = isPluginObject(candidate.hooks);

  if (!hasSetup && !hasHooks) {
    return null;
  }

  return candidate as XyraServerPluginObject;
}

function isHookHandler(value: unknown): value is XyraPluginHookHandler {
  return typeof value === 'function';
}

function getOrCreateRuntimePluginState(manifest: ResolvedPluginManifest): RuntimePluginState {
  const existing = runtimeState.plugins.get(manifest.id);
  if (existing) {
    return existing;
  }

  const state: RuntimePluginState = {
    manifest,
    enabled: isPluginEnabled(manifest),
    loaded: false,
    errors: [],
    hooks: new Set<string>(),
  };

  runtimeState.plugins.set(manifest.id, state);
  return state;
}

function ensureDiscoveryState(): void {
  if (runtimeState.initialized || runtimeState.plugins.size > 0) {
    return;
  }

  const discovery = discoverPlugins();
  runtimeState.discoveryErrors = discovery.errors;

  for (const manifest of discovery.plugins) {
    getOrCreateRuntimePluginState(manifest);
  }
}

function createPluginContext(manifest: ResolvedPluginManifest): XyraPluginContext {
  return {
    plugin: manifest,
    nitroApp: runtimeState.nitroApp,
    log: createPluginLogger(manifest.id),
    emitHook: emitPluginHook,
  };
}

function registerHook(
  pluginState: RuntimePluginState,
  hookName: string,
  handler: XyraPluginHookHandler,
  context: XyraPluginContext,
): void {
  const hookRegistrations = runtimeState.hookHandlers.get(hookName) ?? [];
  hookRegistrations.push({
    pluginId: pluginState.manifest.id,
    handler,
    context,
  });
  runtimeState.hookHandlers.set(hookName, hookRegistrations);
  pluginState.hooks.add(hookName);
}

function cloneNavItems(
  pluginId: string,
  items:
    | NonNullable<ResolvedPluginManifest['contributions']>['adminNavigation']
    | NonNullable<ResolvedPluginManifest['contributions']>['dashboardNavigation']
    | NonNullable<ResolvedPluginManifest['contributions']>['serverNavigation'],
): PluginNavigationContribution[] {
  return (items ?? []).map((item) => {
    const cloned: PluginNavigationContribution = {
      ...item,
      id: `plugin:${pluginId}:${item.id}`,
      pluginId,
      order: item.order ?? 500,
    };

    if (Array.isArray(item.children)) {
      cloned.children = cloneNavItems(pluginId, item.children);
    }

    return cloned;
  });
}

function cloneSlotContributions(
  pluginId: string,
  slots: NonNullable<ResolvedPluginManifest['contributions']>['uiSlots'],
): PluginUiSlotContribution[] {
  return (slots ?? []).map((slot) => ({
    ...slot,
    pluginId,
    order: slot.order ?? 500,
  }));
}

function toSummaryItem(state: RuntimePluginState): PluginRuntimeSummaryItem {
  const contributions = state.manifest.contributions;

  return {
    id: state.manifest.id,
    name: state.manifest.name,
    version: state.manifest.version,
    description: state.manifest.description,
    author: state.manifest.author,
    website: state.manifest.website,
    enabled: state.enabled,
    loaded: state.loaded,
    manifestPath: state.manifest.manifestPath,
    sourceDir: state.manifest.sourceDir,
    serverEntryPath: state.manifest.serverEntryPath,
    moduleEntryPath: state.manifest.moduleEntryPath,
    nuxtLayerPath: state.manifest.nuxtLayerPath,
    migrationsPath: state.manifest.migrationsPath,
    hooks: Array.from(state.hooks).sort(),
    errors: [...state.errors],
    contributions: {
      adminNavigation: cloneNavItems(state.manifest.id, contributions?.adminNavigation),
      dashboardNavigation: cloneNavItems(state.manifest.id, contributions?.dashboardNavigation),
      serverNavigation: cloneNavItems(state.manifest.id, contributions?.serverNavigation),
      uiSlots: cloneSlotContributions(state.manifest.id, contributions?.uiSlots),
    },
  };
}

export async function initializePluginRuntime(nitroApp: unknown): Promise<PluginRuntimeSummary> {
  if (runtimeState.initialized) {
    return getPluginRuntimeSummary();
  }

  runtimeState.nitroApp = nitroApp;
  clearRuntimeState();

  const discovery = discoverPlugins();
  runtimeState.discoveryErrors = discovery.errors;

  for (const manifest of discovery.plugins) {
    const pluginState = getOrCreateRuntimePluginState(manifest);

    if (!pluginState.enabled) {
      continue;
    }

    if (manifest.migrationsPath) {
      try {
        const migrationResult = await applyPluginSqlMigrations(manifest);
        if (migrationResult.applied > 0) {
          console.info(
            `[plugins:${manifest.id}] Applied ${migrationResult.applied}/${migrationResult.total} migration(s).`,
          );
        }
      } catch (error) {
        pluginState.errors.push(`Failed to apply plugin migrations: ${normalizeErrorMessage(error)}`);
        continue;
      }
    }

    if (!manifest.serverEntryPath) {
      pluginState.loaded = true;
      continue;
    }

    const pluginContext = createPluginContext(manifest);

    try {
      const importedModule = await import(pathToFileURL(manifest.serverEntryPath).href);
      const plugin = normalizeImportedPlugin(importedModule);

      if (!plugin) {
        pluginState.errors.push(
          'Plugin server entry must export a setup function or an object with setup/hooks.',
        );
        continue;
      }

      if (typeof plugin === 'function') {
        await plugin(pluginContext);
      } else if (typeof plugin.setup === 'function') {
        await plugin.setup(pluginContext);
      }

      if (isPluginObject(plugin) && isPluginObject(plugin.hooks)) {
        for (const [hookName, hookHandler] of Object.entries(plugin.hooks)) {
          if (!isHookHandler(hookHandler)) {
            pluginState.errors.push(`Hook "${hookName}" is not a function and was ignored.`);
            continue;
          }

          registerHook(pluginState, hookName, hookHandler, pluginContext);
        }
      }

      pluginState.loaded = true;
    } catch (error) {
      pluginState.errors.push(normalizeErrorMessage(error));
    }
  }

  runtimeState.initialized = true;

  return getPluginRuntimeSummary();
}

export async function reloadPluginRuntime(): Promise<PluginRuntimeSummary> {
  const existingNitroApp = runtimeState.nitroApp;
  clearRuntimeState();

  if (!existingNitroApp) {
    return getPluginRuntimeSummary();
  }

  return await initializePluginRuntime(existingNitroApp);
}

export async function emitPluginHook<TPayload = unknown>(
  hookName: string,
  payload?: TPayload,
): Promise<void> {
  const handlers = runtimeState.hookHandlers.get(hookName);

  if (!handlers || handlers.length === 0) {
    return;
  }

  for (const entry of handlers) {
    try {
      await entry.handler(payload, entry.context);
    } catch (error) {
      const pluginState = runtimeState.plugins.get(entry.pluginId);
      const message = `Hook "${hookName}" failed: ${normalizeErrorMessage(error)}`;
      if (pluginState) {
        pluginState.errors.push(message);
      }
      entry.context.log.error(message);
    }
  }
}

export function hasPluginHook(hookName: string): boolean {
  const handlers = runtimeState.hookHandlers.get(hookName);
  return Boolean(handlers && handlers.length > 0);
}

export function getPluginRuntimeSummary(): PluginRuntimeSummary {
  ensureDiscoveryState();

  return {
    initialized: runtimeState.initialized,
    plugins: Array.from(runtimeState.plugins.values())
      .map((state) => toSummaryItem(state))
      .sort((a, b) => a.id.localeCompare(b.id)),
    discoveryErrors: [...runtimeState.discoveryErrors],
  };
}

export function getPluginClientContributions(): PluginClientContributions {
  ensureDiscoveryState();

  const adminNavigation: PluginClientContributions['adminNavigation'] = [];
  const dashboardNavigation: PluginClientContributions['dashboardNavigation'] = [];
  const serverNavigation: PluginClientContributions['serverNavigation'] = [];
  const uiSlots: PluginClientContributions['uiSlots'] = [];

  for (const state of runtimeState.plugins.values()) {
    if (!state.enabled) {
      continue;
    }

    const contributions = state.manifest.contributions;
    if (!contributions) {
      continue;
    }

    adminNavigation.push(...cloneNavItems(state.manifest.id, contributions.adminNavigation));
    dashboardNavigation.push(
      ...cloneNavItems(state.manifest.id, contributions.dashboardNavigation),
    );
    serverNavigation.push(...cloneNavItems(state.manifest.id, contributions.serverNavigation));
    uiSlots.push(...cloneSlotContributions(state.manifest.id, contributions.uiSlots));
  }

  adminNavigation.sort(
    (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY),
  );
  dashboardNavigation.sort(
    (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY),
  );
  serverNavigation.sort(
    (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY),
  );
  uiSlots.sort(
    (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY),
  );

  return { adminNavigation, dashboardNavigation, serverNavigation, uiSlots };
}

export function resetPluginRuntimeStateForTests(): void {
  clearRuntimeState({ clearNitroApp: true });
}
