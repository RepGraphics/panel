import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { tables, useDrizzle } from '#server/utils/drizzle';
import { requireAdmin, readValidatedBodyWithLimit, BODY_SIZE_LIMITS } from '#server/utils/security';
import { requireRouteParam } from '#server/utils/http/params';
import { requireAdminApiKeyPermission } from '#server/utils/admin-api-permissions';
import { ADMIN_ACL_PERMISSIONS, ADMIN_ACL_RESOURCES } from '#server/utils/admin-acl';
import { getPluginRuntimeSummary, reloadPluginRuntime } from '#server/utils/plugins/runtime';
import {
  uninstallPluginSourceDirectory,
  PluginManagementError,
} from '#server/utils/plugins/management';
import { buildPluginScopeSettingKey } from '#server/utils/plugins/scope';
import { applyPluginLayerRefresh } from '#server/utils/plugins/layer-refresh';
import { recordAuditEventFromRequest } from '#server/utils/audit';

const uninstallPluginSchema = z.object({
  autoRestart: z.boolean().optional().default(true),
});

function pluginRequiresNuxtRestart(plugin: {
  moduleEntryPath?: string;
  nuxtLayerPath?: string;
}): boolean {
  return Boolean(plugin.moduleEntryPath || plugin.nuxtLayerPath);
}

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event);

  await requireAdminApiKeyPermission(
    event,
    ADMIN_ACL_RESOURCES.PANEL_SETTINGS,
    ADMIN_ACL_PERMISSIONS.WRITE,
  );

  const pluginId = await requireRouteParam(event, 'id', 'Plugin id is required');
  const body = await readValidatedBodyWithLimit(
    event,
    uninstallPluginSchema,
    BODY_SIZE_LIMITS.SMALL,
  );

  const runtimeBefore = getPluginRuntimeSummary();
  const targetPlugin = runtimeBefore.plugins.find((plugin) => plugin.id === pluginId);

  if (!targetPlugin) {
    throw createError({
      status: 404,
      statusText: 'Not Found',
      message: `Plugin "${pluginId}" was not found.`,
    });
  }

  try {
    await uninstallPluginSourceDirectory(targetPlugin.sourceDir);
  } catch (error) {
    if (error instanceof PluginManagementError) {
      throw createError({
        status: error.statusCode,
        statusText: error.statusCode >= 500 ? 'Plugin uninstall failed' : 'Bad Request',
        message: error.message,
      });
    }

    throw error;
  }

  const db = useDrizzle();
  await db
    .delete(tables.settings)
    .where(eq(tables.settings.key, buildPluginScopeSettingKey(pluginId)));

  const runtimeSummary = await reloadPluginRuntime();
  const restartRequired = pluginRequiresNuxtRestart(targetPlugin);
  const restart = await applyPluginLayerRefresh({
    event,
    restartRequired,
    autoRestart: body.autoRestart,
  });

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.plugins.uninstalled',
    targetType: 'settings',
    metadata: {
      pluginId,
      pluginName: targetPlugin.name,
      sourceDir: targetPlugin.sourceDir,
      restartRequired,
      restartMode: restart.mode,
      restartAutomated: restart.automated,
    },
  });

  return {
    data: {
      pluginId,
      pluginName: targetPlugin.name,
      removed: true,
      restartRequired,
      restartMode: restart.mode,
      restartAutomated: restart.automated,
      message: restart.message,
      summary: {
        initialized: runtimeSummary.initialized,
        pluginCount: runtimeSummary.plugins.length,
        discoveryErrorCount: runtimeSummary.discoveryErrors.length,
      },
    },
  };
});
