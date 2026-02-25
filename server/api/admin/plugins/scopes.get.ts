import { eq, tables, useDrizzle } from '#server/utils/drizzle';
import { requireAdmin } from '#server/utils/security';
import { requireAdminApiKeyPermission } from '#server/utils/admin-api-permissions';
import { ADMIN_ACL_PERMISSIONS, ADMIN_ACL_RESOURCES } from '#server/utils/admin-acl';
import { getPluginRuntimeSummary } from '#server/utils/plugins/runtime';
import { getPluginScopes } from '#server/utils/plugins/scope';
import { recordAuditEventFromRequest } from '#server/utils/audit';
import type { PluginScopeSummary } from '#shared/types/plugins';

export default defineEventHandler(async (event): Promise<{ data: PluginScopeSummary }> => {
  const session = await requireAdmin(event);

  await requireAdminApiKeyPermission(
    event,
    ADMIN_ACL_RESOURCES.PANEL_SETTINGS,
    ADMIN_ACL_PERMISSIONS.READ,
  );

  const runtimeSummary = getPluginRuntimeSummary();
  const pluginIds = runtimeSummary.plugins.map((plugin) => plugin.id);
  const scopes = await getPluginScopes(pluginIds);

  const db = useDrizzle();
  const eggRows = await db
    .select({
      id: tables.eggs.id,
      name: tables.eggs.name,
      nestName: tables.nests.name,
    })
    .from(tables.eggs)
    .leftJoin(tables.nests, eq(tables.nests.id, tables.eggs.nestId));

  const eggs = eggRows
    .map((egg) => ({
      id: egg.id,
      name: egg.name,
      nestName: egg.nestName ?? null,
    }))
    .sort((a, b) => {
      const nestCompare = (a.nestName ?? '').localeCompare(b.nestName ?? '');
      if (nestCompare !== 0) return nestCompare;
      return a.name.localeCompare(b.name);
    });

  await recordAuditEventFromRequest(event, {
    actor: session.user.email || session.user.id,
    actorType: 'user',
    action: 'admin.plugins.scopes.viewed',
    targetType: 'settings',
    metadata: {
      pluginCount: pluginIds.length,
      eggCount: eggs.length,
    },
  });

  return {
    data: {
      scopes,
      eggs,
    },
  };
});
