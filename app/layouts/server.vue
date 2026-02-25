<script setup lang="ts">
import { computed } from 'vue';
import type { PluginNavigationContribution } from '#shared/types/plugins';
import PluginOutlet from '~/components/plugins/PluginOutlet.vue';

interface ServerSidebarItem {
  id?: string;
  label: string;
  icon?: string;
  to?: string;
  active?: boolean;
  order?: number;
  children?: ServerSidebarItem[];
}

const { t } = useI18n();
const route = useRoute();

const serverId = computed(() => route.params.id as string);
const { data: pluginContributions } = await usePluginContributions({ serverId: serverId.value });

const { data: serverResponse } = await useFetch(`/api/client/servers/${serverId.value}`, {
  key: `server-${serverId.value}`,
  watch: [serverId],
});

const server = computed(() => {
  const response = serverResponse.value as { data: { name: string; identifier: string } } | null;
  return response?.data ?? null;
});

const serverName = computed(() => {
  const name = server.value?.name;
  return name && name.trim() ? name : t('common.server');
});

const serverIdentifier = computed(() => {
  const identifier = server.value?.identifier;
  return identifier || serverId.value;
});

const sidebarToggleProps = computed(() => ({
  icon: 'i-lucide-menu',
  color: 'neutral' as const,
  variant: 'ghost' as const,
  'aria-label': t('common.navigation'),
}));

const pluginServerNavigation = computed<PluginNavigationContribution[]>(
  () => pluginContributions.value?.serverNavigation ?? [],
);
const pluginsServerGroupLabel = 'Plugins / Extensions';

function sortSidebarItems(items: ServerSidebarItem[]): ServerSidebarItem[] {
  return items
    .slice()
    .sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY))
    .map((item) => ({
      ...item,
      children:
        Array.isArray(item.children) && item.children.length > 0
          ? sortSidebarItems(item.children)
          : undefined,
    }));
}

function resolveServerNavigationPath(
  value: string | undefined,
  serverBasePath: string,
  currentServerId: string,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const withServerId = trimmed
    .replaceAll('{id}', currentServerId)
    .replaceAll('[id]', currentServerId)
    .replace(/:id(?=\/|$)/g, currentServerId);

  if (withServerId.startsWith('/')) {
    return withServerId;
  }

  const normalized = withServerId.replace(/^\.?\//, '');
  return `${serverBasePath}/${normalized.replace(/^\/+/, '')}`;
}

function mapPluginServerNavItem(
  item: PluginNavigationContribution,
  serverBasePath: string,
  currentServerId: string,
  currentPath: string,
): ServerSidebarItem | null {
  const to = resolveServerNavigationPath(item.to, serverBasePath, currentServerId);

  const children = Array.isArray(item.children)
    ? item.children
        .map((child) =>
          mapPluginServerNavItem(
            child as PluginNavigationContribution,
            serverBasePath,
            currentServerId,
            currentPath,
          ),
        )
        .filter((entry): entry is ServerSidebarItem => Boolean(entry))
    : [];

  if (!to && children.length === 0) {
    return null;
  }

  const active =
    (to ? currentPath === to || currentPath.startsWith(`${to}/`) : false) ||
    children.some((child) => Boolean(child.active));

  return {
    id: item.id,
    label: item.label,
    icon: item.icon,
    to,
    active,
    order: item.order ?? 500,
    children: children.length > 0 ? sortSidebarItems(children) : undefined,
  };
}

const navItems = computed<ServerSidebarItem[]>(() => {
  const basePath = `/server/${serverId.value}`;
  const currentPath = route.path;

  const baseItems: ServerSidebarItem[] = [
    {
      id: 'server-console',
      label: t('server.console.title'),
      icon: 'i-lucide-terminal',
      to: `${basePath}/console`,
      active: currentPath === `${basePath}/console`,
      order: 10,
    },
    {
      id: 'server-activity',
      label: t('server.activity.title'),
      icon: 'i-lucide-activity',
      to: `${basePath}/activity`,
      active: currentPath === `${basePath}/activity`,
      order: 20,
    },
    {
      id: 'server-files',
      label: t('server.files.title'),
      icon: 'i-lucide-folder-open',
      to: `${basePath}/files`,
      active: currentPath.startsWith(`${basePath}/files`),
      order: 30,
    },
    {
      id: 'server-backups',
      label: t('server.backups.title'),
      icon: 'i-lucide-database-backup',
      to: `${basePath}/backups`,
      active: currentPath.startsWith(`${basePath}/backups`),
      order: 40,
    },
    {
      id: 'server-schedules',
      label: t('server.schedules.title'),
      icon: 'i-lucide-calendar-clock',
      to: `${basePath}/schedules`,
      active: currentPath.startsWith(`${basePath}/schedules`),
      order: 50,
    },
    {
      id: 'server-users',
      label: t('server.users.title'),
      icon: 'i-lucide-users',
      to: `${basePath}/users`,
      active: currentPath.startsWith(`${basePath}/users`),
      order: 60,
    },
    {
      id: 'server-databases',
      label: t('server.databases.title'),
      icon: 'i-lucide-database',
      to: `${basePath}/databases`,
      active: currentPath.startsWith(`${basePath}/databases`),
      order: 70,
    },
    {
      id: 'server-network',
      label: t('server.network.title'),
      icon: 'i-lucide-network',
      to: `${basePath}/network`,
      active: currentPath.startsWith(`${basePath}/network`),
      order: 80,
    },
    {
      id: 'server-startup',
      label: t('server.startup.title'),
      icon: 'i-lucide-rocket',
      to: `${basePath}/startup`,
      active: currentPath.startsWith(`${basePath}/startup`),
      order: 90,
    },
    {
      id: 'server-settings',
      label: t('server.settings.title'),
      icon: 'i-lucide-cog',
      to: `${basePath}/settings`,
      active: currentPath.startsWith(`${basePath}/settings`),
      order: 100,
    },
  ];

  const pluginItems = pluginServerNavigation.value
    .map((item) => mapPluginServerNavItem(item, basePath, serverId.value, currentPath))
    .filter((entry): entry is ServerSidebarItem => Boolean(entry));

  const pluginChildren = sortSidebarItems(pluginItems);
  const pluginGroup: ServerSidebarItem[] =
    pluginChildren.length > 0
      ? [
          {
            id: 'server-plugins',
            label: pluginsServerGroupLabel,
            icon: 'i-lucide-puzzle',
            active: pluginChildren.some((entry) => Boolean(entry.active)),
            order: 500,
            children: pluginChildren,
          },
        ]
      : [];

  return sortSidebarItems(baseItems.concat(pluginGroup));
});

function findActiveNavLabel(items: ServerSidebarItem[]): string | null {
  for (const item of items) {
    if (Array.isArray(item.children) && item.children.length > 0) {
      const childLabel = findActiveNavLabel(item.children);
      if (childLabel) {
        return childLabel;
      }
    }

    if (item.active) {
      return item.label;
    }
  }

  return null;
}

const currentPageTitle = computed(() => {
  return findActiveNavLabel(navItems.value) ?? '';
});
</script>

<template>
  <PluginOutlet
    name="server.wrapper.before"
    :server-id="serverId"
    :contributions="pluginContributions"
    :context="{ route: route.path, serverId, serverName, serverIdentifier }"
  />
  <UDashboardGroup
    class="server-layout min-h-screen bg-muted/20"
    storage="local"
    storage-key="server-dashboard"
  >
    <UDashboardSidebar
      role="navigation"
      :aria-label="t('common.navigation')"
      collapsible
      :toggle="sidebarToggleProps"
      :ui="{
        body: 'flex flex-col gap-1 px-2 pb-4',
        header: 'px-4 py-4',
        footer: 'border-t border-default px-4 py-3',
      }"
    >
      <template #header="{ collapsed }">
        <NuxtLink
          to="/server"
          class="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
        >
          <UIcon v-if="collapsed" name="i-lucide-arrow-left" class="mx-auto size-4" />
          <template v-else>
            <UIcon name="i-lucide-arrow-left" class="size-3" />
            {{ t('layout.backToServers') }}
          </template>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="[navItems]" orientation="vertical" />
      </template>
    </UDashboardSidebar>

    <UDashboardPanel :ui="{ body: 'flex flex-1 flex-col p-0' }">
      <template #body>
        <header role="banner">
          <PluginOutlet
            name="server.layout.before-navbar"
            :server-id="serverId"
            :contributions="pluginContributions"
            :context="{ route: route.path, serverId, serverName, serverIdentifier }"
          />
          <UDashboardNavbar
            :ui="{
              left: 'flex flex-col gap-0.5 text-left leading-tight sm:flex-row sm:items-baseline sm:gap-2',
              root: 'justify-between items-center px-4 py-1.5 sm:px-6 sm:py-2',
            }"
          >
            <template #left>
              <div
                class="flex flex-col gap-0.5 leading-tight sm:flex-row sm:items-baseline sm:gap-2"
              >
                <h1 class="text-base font-semibold text-foreground sm:text-lg">
                  {{ serverName }}
                  <span v-if="currentPageTitle" class="text-sm font-normal text-muted-foreground"
                    >- {{ currentPageTitle }}</span
                  >
                </h1>
                <p class="text-xs text-muted-foreground">{{ serverIdentifier }}</p>
              </div>
            </template>
          </UDashboardNavbar>
          <PluginOutlet
            name="server.layout.after-navbar"
            :server-id="serverId"
            :contributions="pluginContributions"
            :context="{ route: route.path, serverId, serverName, serverIdentifier }"
          />
        </header>

        <main class="flex-1 overflow-y-auto">
          <div class="w-full px-4 py-5 sm:px-6 space-y-6">
            <PluginOutlet
              name="server.layout.before-content"
              :server-id="serverId"
              :contributions="pluginContributions"
              :context="{ route: route.path, serverId, serverName, serverIdentifier }"
            />
            <slot />
            <PluginOutlet
              name="server.layout.after-content"
              :server-id="serverId"
              :contributions="pluginContributions"
              :context="{ route: route.path, serverId, serverName, serverIdentifier }"
            />
          </div>
        </main>
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
  <PluginOutlet
    name="server.wrapper.after"
    :server-id="serverId"
    :contributions="pluginContributions"
    :context="{ route: route.path, serverId, serverName, serverIdentifier }"
  />
</template>
