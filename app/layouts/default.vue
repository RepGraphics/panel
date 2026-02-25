<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { NavigationMenuItem } from '@nuxt/ui';
import type { AdminNavItem } from '#shared/types/admin';
import type { PluginNavigationContribution } from '#shared/types/plugins';
import PluginOutlet from '~/components/plugins/PluginOutlet.vue';
const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();
const runtimeConfig = useRuntimeConfig();
const appName = computed(() => runtimeConfig.public.appName || 'XyraPanel');

const pageTitle = computed(() => {
  const title = route.meta.title;
  if (typeof title === 'string' && title.length > 0) {
    return title;
  }
  return appName.value;
});

const pageSubtitle = computed(() => {
  const subtitle = route.meta.subtitle;
  if (typeof subtitle === 'string' && subtitle.length > 0) {
    return subtitle;
  }
  if (route.name === 'index' || route.path === '/') {
    return t('dashboard.description');
  }
  return null;
});

const authStore = useAuthStore();
const isHydrated = ref(false);
onMounted(() => {
  isHydrated.value = true;
});
const { user, isAdmin: isAdminRef, status: authStatus } = storeToRefs(authStore);
const signOutLoading = ref(false);

const { isImpersonating, impersonatedUserName, stopImpersonating, stopImpersonationLoading } =
  useImpersonationControls({ redirectTo: '/admin' });

const { data: securitySettings } = await useFetch<{
  maintenanceMode: boolean;
  maintenanceMessage: string;
}>('/api/maintenance-status', {
  key: 'default-layout-security-settings',
  default: () => ({
    maintenanceMode: false,
    maintenanceMessage: '',
  }),
});

const { data: brandingSettings } = await useFetch('/api/branding', {
  key: 'default-layout-branding-settings',
  default: () =>
    ({
      showBrandLogo: true,
      brandLogoUrl: '/logo.png',
    }) as { showBrandLogo: boolean; brandLogoUrl: string | null },
});

const showBrandLogo = computed(() => brandingSettings.value?.showBrandLogo !== false);
const brandLogoUrl = computed(() => brandingSettings.value?.brandLogoUrl || '/logo.png');

const isMaintenanceMode = computed(() => {
  if (!securitySettings.value?.maintenanceMode) return false;
  if (authStatus.value === 'loading' || authStatus.value === 'unauthenticated') return false;
  const isAdmin = isAdminRef.value || user.value?.role === 'admin';
  return !isAdmin;
});
const maintenanceMessage = computed(
  () => securitySettings.value?.maintenanceMessage?.trim() || t('layout.defaultMaintenanceMessage'),
);

const fallbackUserLabel = computed(() => t('common.user'));
const userLabel = computed(() => {
  if (!user.value) return t('common.user');
  return user.value.username || user.value.email || user.value.name || t('common.user');
});

const displayUserLabel = computed(() =>
  isHydrated.value ? userLabel.value : fallbackUserLabel.value,
);

const userAvatar = computed(() => {
  const label = isHydrated.value ? userLabel.value : fallbackUserLabel.value;
  return {
    alt: label,
    text: label === t('common.user') ? 'U' : label.slice(0, 2).toUpperCase(),
  };
});

async function handleSignOut() {
  if (signOutLoading.value) {
    return;
  }

  signOutLoading.value = true;
  try {
    await clearNuxtData();
    await authStore.logout();
    await navigateTo(localePath('/auth/login'));
  } catch {
    signOutLoading.value = false;
  }
}

const { data: pluginContributions } = await usePluginContributions();

const CLIENT_NAV_ITEMS = computed<AdminNavItem[]>(() => [
  {
    id: 'client-dashboard',
    label: t('dashboard.title'),
    to: '/',
    order: 0,
  },
  {
    id: 'client-servers',
    label: t('server.list.title'),
    to: '/server',
    order: 10,
  },
  {
    id: 'client-account-profile',
    label: t('account.profile.title'),
    to: '/account/profile',
    order: 20,
  },
  {
    id: 'client-account-security',
    label: t('account.security.title'),
    to: '/account/security',
    order: 25,
  },
  {
    id: 'client-account-api-keys',
    label: t('account.apiKeys.title'),
    to: '/account/api-keys',
    order: 30,
  },
  {
    id: 'client-account-ssh-keys',
    label: t('account.sshKeys.title'),
    to: '/account/ssh-keys',
    order: 35,
  },
  {
    id: 'client-account-sessions',
    label: t('account.sessions.title'),
    to: '/account/sessions',
    order: 40,
  },
  {
    id: 'client-account-activity',
    label: t('account.activity.title'),
    to: '/account/activity',
    order: 45,
  },
]);

const pluginDashboardNavigation = computed<PluginNavigationContribution[]>(
  () => pluginContributions.value?.dashboardNavigation ?? [],
);

const pluginsDashboardGroupLabel = 'Plugins / Extensions';

function sortDashboardNav(items: AdminNavItem[]): AdminNavItem[] {
  return items
    .slice()
    .sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY))
    .map((item) => ({
      ...item,
      children: item.children ? sortDashboardNav(item.children) : undefined,
    }));
}

function resolveDashboardPath(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
  return localePath(normalized);
}

function mapDashboardNavItem(item: AdminNavItem): NavigationMenuItem | null {
  const to = resolveDashboardPath(item.to);
  const children = Array.isArray(item.children)
    ? item.children
        .map((child) => mapDashboardNavItem(child))
        .filter((entry): entry is NavigationMenuItem => Boolean(entry))
    : [];

  if (!to && children.length === 0) {
    return null;
  }

  return {
    label: item.label,
    icon: item.icon,
    to,
    children: children.length > 0 ? children : undefined,
  };
}

const navigationItems = computed<NavigationMenuItem[]>(() => {
  const coreItems = sortDashboardNav(CLIENT_NAV_ITEMS.value)
    .map((entry) => mapDashboardNavItem(entry))
    .filter((entry): entry is NavigationMenuItem => Boolean(entry));

  const pluginItems = sortDashboardNav(pluginDashboardNavigation.value)
    .map((entry) => mapDashboardNavItem(entry))
    .filter((entry): entry is NavigationMenuItem => Boolean(entry));

  if (pluginItems.length === 0) {
    return coreItems;
  }

  return coreItems.concat({
    label: pluginsDashboardGroupLabel,
    icon: 'i-lucide-puzzle',
    children: pluginItems,
  });
});

const isAdminUser = computed(() => {
  if (isAdminRef.value) return true;
  if (user.value?.role === 'admin') return true;
  return false;
});

const { locale, locales } = useI18n();
const switchLocalePath = useSwitchLocalePath();

const sidebarToggleProps = computed(() => ({
  icon: 'i-lucide-menu',
  color: 'neutral' as const,
  variant: 'ghost' as const,
  'aria-label': t('common.navigation'),
}));

const uiLocales = computed(() => {
  return locales.value.map((loc) => {
    const dir = typeof loc === 'string' ? 'ltr' : loc.dir || 'ltr';
    return {
      code: typeof loc === 'string' ? loc : loc.code,
      name: typeof loc === 'string' ? loc : loc.name || loc.code,
      language: typeof loc === 'string' ? loc : loc.language || loc.code,
      dir: (dir === 'auto' ? 'ltr' : dir) as 'ltr' | 'rtl',
      messages: {},
    };
  });
});

async function handleLocaleChange(newLocale: string | undefined) {
  if (!newLocale || newLocale === locale.value) return;

  const validLocale = locales.value.find((l) => {
    const code = typeof l === 'string' ? l : l.code;
    return code === newLocale;
  });

  if (validLocale) {
    const code = typeof validLocale === 'string' ? validLocale : validLocale.code;
    const path = switchLocalePath(code);
    if (path) {
      // Normalize path - ensure trailing slash for root locale paths
      // switchLocalePath returns '/es' for root route, but we need '/es/'
      const normalizedPath = path === '/es' && route.path === '/' ? '/es/' : path;
      await navigateTo(normalizedPath);
    }
  }
}
</script>

<template>
  <PluginOutlet
    name="client.wrapper.before"
    :contributions="pluginContributions"
    :context="{ route: route.path, title: pageTitle, subtitle: pageSubtitle }"
  />
  <UDashboardGroup
    class="default-layout min-h-screen bg-muted/30"
    storage="local"
    storage-key="client-dashboard"
  >
    <UDashboardSidebar
      role="navigation"
      :aria-label="t('common.navigation')"
      collapsible
      :toggle="sidebarToggleProps"
      :ui="{ footer: 'border-t border-default' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink
          v-if="!collapsed"
          :to="localePath('index')"
          class="group inline-flex items-center gap-3"
        >
          <img v-if="showBrandLogo" :src="brandLogoUrl" alt="" class="h-12 w-auto" />
          <UIcon v-else name="i-simple-icons-nuxtdotjs" class="size-5 text-primary" />
          <h1
            class="text-lg font-semibold text-muted-foreground group-hover:text-foreground transition"
          >
            {{ appName }}
          </h1>
        </NuxtLink>
        <UIcon v-else name="i-simple-icons-nuxtdotjs" class="mx-auto size-5 text-primary" />
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="navigationItems" orientation="vertical" />
      </template>

      <template #footer="{ collapsed }">
        <UDropdownMenu
          :items="[
            [
              { label: t('account.profile.title'), to: localePath('/account/profile') },
              { label: t('account.security.title'), to: localePath('/account/security') },
              { label: t('account.apiKeys.title'), to: localePath('/account/api-keys') },
              { label: t('account.sshKeys.title'), to: localePath('/account/ssh-keys') },
              { label: t('account.sessions.title'), to: localePath('/account/sessions') },
              { label: t('account.activity.title'), to: localePath('/account/activity') },
            ],
            [{ label: t('auth.signOut'), click: handleSignOut, color: 'error' }],
          ]"
        >
          <UButton
            color="neutral"
            variant="ghost"
            class="w-full"
            :block="collapsed"
            type="button"
            @click.prevent
          >
            <template #leading>
              <UAvatar v-bind="userAvatar" size="sm" />
            </template>
            <span v-if="!collapsed">{{ displayUserLabel }}</span>
          </UButton>
        </UDropdownMenu>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel :key="'dashboard-panel'" :ui="{ body: 'flex flex-1 flex-col p-0' }">
      <template #body>
        <header role="banner">
          <PluginOutlet
            name="client.layout.before-navbar"
            :contributions="pluginContributions"
            :context="{ route: route.path, title: pageTitle, subtitle: pageSubtitle }"
          />
          <UDashboardNavbar
            :ui="{
              left: 'flex flex-col gap-0.5 text-left leading-tight sm:flex-row sm:items-baseline sm:gap-2',
              root: 'justify-between items-center px-4 py-1.5 sm:px-6 sm:py-2',
            }"
          >
            <template #left>
              <div
                v-if="pageTitle"
                class="flex flex-col gap-0.5 leading-tight sm:flex-row sm:items-baseline sm:gap-2"
              >
                <h1 class="text-base font-semibold text-foreground sm:text-lg">{{ pageTitle }}</h1>
                <p v-if="pageSubtitle" class="text-xs text-muted-foreground">{{ pageSubtitle }}</p>
              </div>
            </template>
            <template #right>
              <div class="flex items-center gap-2">
                <ULocaleSelect
                  :model-value="locale"
                  :locales="uiLocales"
                  size="sm"
                  variant="ghost"
                  class="w-32"
                  @update:model-value="handleLocaleChange($event)"
                />
                <UButton
                  v-if="isHydrated && isAdminUser"
                  icon="i-lucide-shield"
                  variant="ghost"
                  color="error"
                  to="/admin"
                >
                  {{ t('admin.title') }}
                </UButton>
                <UButton
                  icon="i-lucide-log-out"
                  color="primary"
                  variant="subtle"
                  :loading="signOutLoading"
                  @click="handleSignOut"
                >
                  {{ t('auth.signOut') }}
                </UButton>
              </div>
            </template>
          </UDashboardNavbar>
          <PluginOutlet
            name="client.layout.after-navbar"
            :contributions="pluginContributions"
            :context="{ route: route.path, title: pageTitle, subtitle: pageSubtitle }"
          />
        </header>

        <main class="flex-1 overflow-y-auto">
          <div
            v-if="isMaintenanceMode"
            class="mx-auto flex w-full max-w-4xl flex-col items-center gap-4 px-6 py-16 text-center"
          >
            <UIcon name="i-lucide-construction" class="size-16 text-warning" />
            <div class="space-y-2">
              <h2 class="text-xl font-semibold">{{ t('layout.weArePerformingMaintenance') }}</h2>
              <p class="text-sm text-muted-foreground whitespace-pre-wrap">
                {{ maintenanceMessage }}
              </p>
            </div>
            <UButton variant="ghost" color="neutral" @click="handleSignOut">
              {{ t('auth.signOut') }}
            </UButton>
          </div>
          <div v-else class="px-4 py-5 sm:px-6 space-y-6">
            <UAlert
              v-if="isImpersonating"
              color="error"
              variant="soft"
              icon="i-lucide-user-round-minus"
            >
              <template #title>
                {{ t('layout.impersonationBannerTitle', { user: impersonatedUserName }) }}
              </template>
              <template #description>
                {{ t('layout.impersonationBannerDescription', { user: impersonatedUserName }) }}
              </template>
              <template #actions>
                <UButton
                  size="xs"
                  color="error"
                  :loading="stopImpersonationLoading"
                  @click="() => stopImpersonating()"
                >
                  {{ t('layout.stopImpersonating') }}
                </UButton>
              </template>
            </UAlert>
            <PluginOutlet
              name="client.layout.before-content"
              :contributions="pluginContributions"
              :context="{ route: route.path, title: pageTitle, subtitle: pageSubtitle }"
            />
            <slot />
            <PluginOutlet
              name="client.layout.after-content"
              :contributions="pluginContributions"
              :context="{ route: route.path, title: pageTitle, subtitle: pageSubtitle }"
            />
          </div>
        </main>
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
  <PluginOutlet
    name="client.wrapper.after"
    :contributions="pluginContributions"
    :context="{ route: route.path, title: pageTitle, subtitle: pageSubtitle }"
  />
</template>
