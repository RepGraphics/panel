import type { PluginClientContributions } from '#shared/types/plugins';

function defaultContributions(): PluginClientContributions {
  return {
    adminNavigation: [],
    dashboardNavigation: [],
    serverNavigation: [],
    uiSlots: [],
  };
}

export async function usePluginContributions(options: { serverId?: string } = {}) {
  const requestFetch = useRequestFetch();
  const scopedServerId =
    typeof options.serverId === 'string' && options.serverId.trim().length > 0
      ? options.serverId.trim()
      : null;
  const key = scopedServerId ? `plugin-contributions:server:${scopedServerId}` : 'plugin-contributions';

  return await useAsyncData<PluginClientContributions>(
    key,
    async () => {
      try {
        const response = await requestFetch<{ data: PluginClientContributions }>(
          '/api/plugins/contributions',
          scopedServerId
            ? {
                query: {
                  serverId: scopedServerId,
                },
              }
            : undefined,
        );
        return response.data;
      } catch {
        return defaultContributions();
      }
    },
    {
      default: defaultContributions,
      deep: false,
      dedupe: 'defer',
    },
  );
}
