import { requireAdmin } from '#server/utils/security';
import { recordAuditEventFromRequest } from '#server/utils/audit';
import { getPluginRuntimeSummary } from '#server/utils/plugins/runtime';
import { requireAdminApiKeyPermission } from '#server/utils/admin-api-permissions';
import { ADMIN_ACL_PERMISSIONS, ADMIN_ACL_RESOURCES } from '#server/utils/admin-acl';
import type { PluginRuntimeSummary } from '#shared/types/plugins';

export default defineEventHandler(async (event): Promise<{ data: PluginRuntimeSummary }> => {
  const session = await requireAdmin(event);

  await requireAdminApiKeyPermission(
    event,
    ADMIN_ACL_RESOURCES.PANEL_SETTINGS,
    ADMIN_ACL_PERMISSIONS.READ,
  );

  const summary = getPluginRuntimeSummary();

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.plugins.viewed',
    targetType: 'settings',
    metadata: {
      pluginCount: summary.plugins.length,
    },
  });

  return {
    data: summary,
  };
});
