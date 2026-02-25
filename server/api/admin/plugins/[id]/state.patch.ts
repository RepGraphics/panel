import { z } from 'zod';
import { requireAdmin, readValidatedBodyWithLimit, BODY_SIZE_LIMITS } from '#server/utils/security';
import { requireRouteParam } from '#server/utils/http/params';
import { requireAdminApiKeyPermission } from '#server/utils/admin-api-permissions';
import { ADMIN_ACL_PERMISSIONS, ADMIN_ACL_RESOURCES } from '#server/utils/admin-acl';
import { getPluginRuntimeSummary, reloadPluginRuntime } from '#server/utils/plugins/runtime';
import {
  setPluginManifestEnabledState,
  PluginManagementError,
} from '#server/utils/plugins/management';
import { applyPluginLayerRefresh } from '#server/utils/plugins/layer-refresh';
import { recordAuditEventFromRequest } from '#server/utils/audit';

const pluginStateUpdateSchema = z.object({
  enabled: z.boolean(),
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
    pluginStateUpdateSchema,
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
    await setPluginManifestEnabledState(targetPlugin.manifestPath, body.enabled);
  } catch (error) {
    if (error instanceof PluginManagementError) {
      throw createError({
        status: error.statusCode,
        statusText: error.statusCode >= 500 ? 'Plugin state update failed' : 'Bad Request',
        message: error.message,
      });
    }

    throw error;
  }

  const runtimeSummary = await reloadPluginRuntime();
  const updatedPlugin = runtimeSummary.plugins.find((plugin) => plugin.id === pluginId) ?? null;
  const restartRequired = pluginRequiresNuxtRestart(targetPlugin);
  const restart = await applyPluginLayerRefresh({
    event,
    restartRequired,
    autoRestart: body.autoRestart,
  });

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: body.enabled ? 'admin.plugins.enabled' : 'admin.plugins.disabled',
    targetType: 'settings',
    metadata: {
      pluginId,
      enabled: body.enabled,
      restartRequired,
      restartMode: restart.mode,
      restartAutomated: restart.automated,
    },
  });

  return {
    data: {
      pluginId,
      enabled: body.enabled,
      restartRequired,
      restartMode: restart.mode,
      restartAutomated: restart.automated,
      message: restart.message,
      runtime: updatedPlugin
        ? {
            loaded: updatedPlugin.loaded,
            errors: updatedPlugin.errors,
          }
        : null,
      summary: {
        initialized: runtimeSummary.initialized,
        pluginCount: runtimeSummary.plugins.length,
        discoveryErrorCount: runtimeSummary.discoveryErrors.length,
      },
    },
  };
});
