import { inArray, useDrizzle, tables, eq } from '#server/utils/drizzle';
import type { PluginRenderScope } from '#shared/types/plugins';

const PLUGIN_SCOPE_SETTINGS_PREFIX = 'plugins:scope:';

const DEFAULT_PLUGIN_SCOPE: PluginRenderScope = {
  mode: 'global',
  eggIds: [],
};

export function buildPluginScopeSettingKey(pluginId: string): string {
  return `${PLUGIN_SCOPE_SETTINGS_PREFIX}${pluginId}`;
}

function normalizeEggIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0),
    ),
  );
}

function normalizeScope(value: unknown): PluginRenderScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_PLUGIN_SCOPE };
  }

  const candidate = value as {
    mode?: unknown;
    eggIds?: unknown;
  };

  const mode = candidate.mode === 'eggs' ? 'eggs' : 'global';
  const eggIds = normalizeEggIds(candidate.eggIds);

  if (mode === 'global') {
    return { mode: 'global', eggIds: [] };
  }

  return { mode: 'eggs', eggIds };
}

function parseScopeValue(raw: string | null | undefined): PluginRenderScope {
  if (!raw || raw.trim().length === 0) {
    return { ...DEFAULT_PLUGIN_SCOPE };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeScope(parsed);
  } catch {
    return { ...DEFAULT_PLUGIN_SCOPE };
  }
}

export async function getPluginScopes(pluginIds: string[]): Promise<Record<string, PluginRenderScope>> {
  const uniquePluginIds = Array.from(new Set(pluginIds.map((entry) => entry.trim()).filter(Boolean)));

  if (uniquePluginIds.length === 0) {
    return {};
  }

  const settingsKeys = uniquePluginIds.map((pluginId) => buildPluginScopeSettingKey(pluginId));
  const db = useDrizzle();

  const rows = await db
    .select({
      key: tables.settings.key,
      value: tables.settings.value,
    })
    .from(tables.settings)
    .where(inArray(tables.settings.key, settingsKeys));

  const valueByKey = new Map(rows.map((row) => [row.key, row.value]));

  const scopes: Record<string, PluginRenderScope> = {};
  for (const pluginId of uniquePluginIds) {
    const key = buildPluginScopeSettingKey(pluginId);
    scopes[pluginId] = parseScopeValue(valueByKey.get(key));
  }

  return scopes;
}

export async function getPluginScope(pluginId: string): Promise<PluginRenderScope> {
  const db = useDrizzle();
  const settingKey = buildPluginScopeSettingKey(pluginId);

  const [row] = await db
    .select({
      value: tables.settings.value,
    })
    .from(tables.settings)
    .where(eq(tables.settings.key, settingKey))
    .limit(1);

  return parseScopeValue(row?.value);
}

export async function setPluginScope(
  pluginId: string,
  scope: PluginRenderScope,
): Promise<PluginRenderScope> {
  const normalizedScope = normalizeScope(scope);
  const db = useDrizzle();
  const settingKey = buildPluginScopeSettingKey(pluginId);

  await db
    .insert(tables.settings)
    .values({
      key: settingKey,
      value: JSON.stringify(normalizedScope),
    })
    .onConflictDoUpdate({
      target: tables.settings.key,
      set: {
        value: JSON.stringify(normalizedScope),
      },
    });

  return normalizedScope;
}

export function isScopeEnabledForEgg(scope: PluginRenderScope | undefined, eggId: string | null): boolean {
  const effectiveScope = scope ?? DEFAULT_PLUGIN_SCOPE;
  if (effectiveScope.mode === 'global') {
    return true;
  }

  if (!eggId) {
    return false;
  }

  return effectiveScope.eggIds.includes(eggId);
}
