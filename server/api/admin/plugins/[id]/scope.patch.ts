import { z } from 'zod';
import { inArray, tables, useDrizzle } from '#server/utils/drizzle';
import { requireAdmin, readValidatedBodyWithLimit, BODY_SIZE_LIMITS } from '#server/utils/security';
import { requireRouteParam } from '#server/utils/http/params';
import { requireAdminApiKeyPermission } from '#server/utils/admin-api-permissions';
import { ADMIN_ACL_PERMISSIONS, ADMIN_ACL_RESOURCES } from '#server/utils/admin-acl';
import { getPluginRuntimeSummary } from '#server/utils/plugins/runtime';
import { setPluginScope } from '#server/utils/plugins/scope';
import { recordAuditEventFromRequest } from '#server/utils/audit';
import type { PluginRenderScope } from '#shared/types/plugins';

const scopeSchema = z.object({
  mode: z.enum(['global', 'eggs']),
  eggIds: z.array(z.string().trim().min(1)).optional().default([]),
});

function normalizeScopeInput(input: PluginRenderScope): PluginRenderScope {
  if (input.mode === 'global') {
    return {
      mode: 'global',
      eggIds: [],
    };
  }

  return {
    mode: 'eggs',
    eggIds: Array.from(new Set(input.eggIds.map((entry) => entry.trim()).filter(Boolean))),
  };
}

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event);

  await requireAdminApiKeyPermission(
    event,
    ADMIN_ACL_RESOURCES.PANEL_SETTINGS,
    ADMIN_ACL_PERMISSIONS.WRITE,
  );

  const pluginId = await requireRouteParam(event, 'id', 'Plugin id is required');
  const body = await readValidatedBodyWithLimit(event, scopeSchema, BODY_SIZE_LIMITS.SMALL);
  const normalizedScope = normalizeScopeInput(body);

  const runtimeSummary = getPluginRuntimeSummary();
  const targetPlugin = runtimeSummary.plugins.find((plugin) => plugin.id === pluginId);

  if (!targetPlugin) {
    throw createError({
      status: 404,
      statusText: 'Not Found',
      message: `Plugin "${pluginId}" was not found.`,
    });
  }

  if (normalizedScope.mode === 'eggs' && normalizedScope.eggIds.length === 0) {
    throw createError({
      status: 400,
      statusText: 'Bad Request',
      message: 'Select at least one egg when using egg-scoped mode.',
    });
  }

  if (normalizedScope.mode === 'eggs') {
    const db = useDrizzle();
    const eggRows = await db
      .select({ id: tables.eggs.id })
      .from(tables.eggs)
      .where(inArray(tables.eggs.id, normalizedScope.eggIds));

    const existingEggIds = new Set(eggRows.map((egg) => egg.id));
    const unknownEggIds = normalizedScope.eggIds.filter((eggId) => !existingEggIds.has(eggId));

    if (unknownEggIds.length > 0) {
      throw createError({
        status: 400,
        statusText: 'Bad Request',
        message: `Unknown egg id(s): ${unknownEggIds.join(', ')}`,
      });
    }
  }

  const savedScope = await setPluginScope(pluginId, normalizedScope);

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.plugins.scope.updated',
    targetType: 'settings',
    metadata: {
      pluginId,
      mode: savedScope.mode,
      eggCount: savedScope.eggIds.length,
    },
  });

  return {
    data: {
      pluginId,
      scope: savedScope,
    },
  };
});
