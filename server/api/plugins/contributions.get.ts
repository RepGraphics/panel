import { requireAccountUser } from '#server/utils/security';
import { getPluginClientContributions } from '#server/utils/plugins/runtime';
import { getPluginScopes, isScopeEnabledForEgg } from '#server/utils/plugins/scope';
import { getServerWithAccess } from '#server/utils/server-helpers';
import type {
  PluginClientContributions,
  PluginNavigationContribution,
} from '#shared/types/plugins';

function hasRequiredPermission(
  required: string | string[] | undefined,
  permissions: string[],
  isAdmin: boolean,
): boolean {
  if (!required || isAdmin) {
    return true;
  }

  if (Array.isArray(required)) {
    return required.some((entry) => permissions.includes(entry));
  }

  return permissions.includes(required);
}

function filterAdminNavigation(
  entries: PluginNavigationContribution[],
  permissions: string[],
  isAdmin: boolean,
): PluginNavigationContribution[] {
  const normalizeChildren = (
    children: PluginNavigationContribution['children'],
    fallbackPluginId: string,
  ): PluginNavigationContribution[] => {
    if (!Array.isArray(children) || children.length === 0) {
      return [];
    }

    return children.map((child) => ({
      ...child,
      pluginId:
        'pluginId' in child && typeof child.pluginId === 'string'
          ? child.pluginId
          : fallbackPluginId,
    }));
  };

  return entries
    .map((entry) => {
      const allowed = hasRequiredPermission(entry.permission, permissions, isAdmin);
      if (!allowed) {
        return null;
      }

      const cloned: PluginNavigationContribution = {
        ...entry,
      };

      if (Array.isArray(entry.children) && entry.children.length > 0) {
        const filteredChildren = filterAdminNavigation(
          normalizeChildren(entry.children, entry.pluginId),
          permissions,
          isAdmin,
        );

        if (filteredChildren.length > 0) {
          cloned.children = filteredChildren;
        } else {
          delete cloned.children;
        }
      }

      return cloned;
    })
    .filter((entry): entry is PluginNavigationContribution => Boolean(entry));
}

export default defineEventHandler(async (event): Promise<{ data: PluginClientContributions }> => {
  const { session, user } = await requireAccountUser(event);
  const permissions = user.permissions;
  const isAdmin = user.role === 'admin';
  const query = getQuery(event);
  const serverIdentifier =
    typeof query.serverId === 'string' && query.serverId.trim().length > 0
      ? query.serverId.trim()
      : null;
  const contributions = getPluginClientContributions();

  let serverEggId: string | null = null;
  if (serverIdentifier) {
    const { server } = await getServerWithAccess(serverIdentifier, session);
    serverEggId = server.eggId ?? null;
  }

  const scopedPluginIds = Array.from(
    new Set(
      contributions.serverNavigation
        .map((entry) => entry.pluginId)
        .concat(contributions.uiSlots.map((entry) => entry.pluginId)),
    ),
  );
  const pluginScopes = await getPluginScopes(scopedPluginIds);

  const isContributionEnabled = (pluginId: string): boolean => {
    if (!serverIdentifier) {
      return true;
    }

    return isScopeEnabledForEgg(pluginScopes[pluginId], serverEggId);
  };

  const filteredAdminNavigation = filterAdminNavigation(
    contributions.adminNavigation,
    permissions,
    isAdmin,
  );
  const filteredDashboardNavigation = filterAdminNavigation(
    contributions.dashboardNavigation,
    permissions,
    isAdmin,
  );
  const filteredServerNavigation = filterAdminNavigation(
    contributions.serverNavigation,
    permissions,
    isAdmin,
  ).filter((entry) => isContributionEnabled(entry.pluginId));

  const filteredSlots = contributions.uiSlots.filter((slot) =>
    hasRequiredPermission(slot.permission, permissions, isAdmin) &&
    isContributionEnabled(slot.pluginId),
  );

  return {
    data: {
      adminNavigation: filteredAdminNavigation,
      dashboardNavigation: filteredDashboardNavigation,
      serverNavigation: filteredServerNavigation,
      uiSlots: filteredSlots,
    },
  };
});
