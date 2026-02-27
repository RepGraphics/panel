<script setup lang="ts">
import type {
  PluginRenderScope,
  PluginRuntimeSummary,
  PluginScopeSummary,
} from '#shared/types/plugins';

interface PluginScopeUpdateResponseData {
  pluginId: string;
  scope: PluginRenderScope;
}

definePageMeta({
  auth: true,
  adminTitle: 'Plugins',
  adminSubtitle: 'Installed plugin manifests and runtime status',
});

const toast = useToast();
const requestFetch = useRequestFetch();

const { data, pending, error, refresh } = await useAsyncData<PluginRuntimeSummary>(
  'admin-plugins-summary',
  async () => {
    const response = (await requestFetch('/api/admin/plugins')) as { data: PluginRuntimeSummary };
    return (response as { data: PluginRuntimeSummary }).data;
  },
  {
    default: () => ({
      initialized: false,
      pluginSystemVersion: 'unknown',
      plugins: [],
      discoveryErrors: [],
    }),
    dedupe: 'defer',
  },
);

const summary = computed(() => data.value);
const pluginCount = computed(() => summary.value.plugins.length);
const loadedCount = computed(
  () => summary.value.plugins.filter((plugin) => plugin.enabled && plugin.loaded).length,
);
const failedCount = computed(
  () => summary.value.plugins.filter((plugin) => plugin.enabled && !plugin.loaded).length,
);
const pluginSystemVersion = computed(() => summary.value.pluginSystemVersion || 'unknown');

const {
  data: pluginScopeSummary,
  pending: pluginScopePending,
  refresh: refreshPluginScopes,
} = await useAsyncData<PluginScopeSummary>(
  'admin-plugin-scopes',
  async () => {
    const response = (await requestFetch('/api/admin/plugins/scopes')) as {
      data: PluginScopeSummary;
    };
    return (response as { data: PluginScopeSummary }).data;
  },
  {
    default: () => ({
      scopes: {},
      eggs: [],
    }),
    dedupe: 'defer',
  },
);

const scopeModeItems = [
  { label: 'Global extension', value: 'global' },
  { label: 'Specific eggs', value: 'eggs' },
];

const eggScopeOptions = computed(() =>
  pluginScopeSummary.value.eggs.map((egg) => ({
    value: egg.id,
    label: egg.nestName ? `${egg.nestName} - ${egg.name}` : egg.name,
  })),
);

const pluginScopeModels = ref<Record<string, PluginRenderScope>>({});
const pluginScopeSaving = ref<Record<string, boolean>>({});

const pluginDetailsOpen = ref<Record<string, boolean>>({});

function normalizeInstallErrorMessage(errorValue: unknown): string {
  if (!errorValue) {
    return 'Request failed.';
  }

  if (typeof errorValue === 'string') {
    return errorValue;
  }

  if (errorValue instanceof Error) {
    return errorValue.message;
  }

  if (typeof errorValue === 'object') {
    const candidate = errorValue as {
      message?: unknown;
      data?: { message?: unknown };
      statusMessage?: unknown;
    };

    if (typeof candidate.data?.message === 'string' && candidate.data.message.length > 0) {
      return candidate.data.message;
    }

    if (typeof candidate.message === 'string' && candidate.message.length > 0) {
      return candidate.message;
    }

    if (typeof candidate.statusMessage === 'string' && candidate.statusMessage.length > 0) {
      return candidate.statusMessage;
    }
  }

  return 'Request failed.';
}

function getDefaultPluginScope(): PluginRenderScope {
  return {
    mode: 'global',
    eggIds: [],
  };
}

function clonePluginScope(scope: PluginRenderScope | undefined): PluginRenderScope {
  if (!scope || scope.mode === 'global') {
    return getDefaultPluginScope();
  }

  return {
    mode: 'eggs',
    eggIds: Array.from(new Set(scope.eggIds.map((entry) => entry.trim()).filter(Boolean))),
  };
}

function normalizePluginScopeForSave(scope: PluginRenderScope): PluginRenderScope {
  if (scope.mode === 'global') {
    return {
      mode: 'global',
      eggIds: [],
    };
  }

  return {
    mode: 'eggs',
    eggIds: Array.from(new Set(scope.eggIds.map((entry) => entry.trim()).filter(Boolean))),
  };
}

function ensurePluginScopeModel(pluginId: string): PluginRenderScope {
  const existing = pluginScopeModels.value[pluginId];
  if (existing) {
    return existing;
  }

  const seeded = clonePluginScope(pluginScopeSummary.value.scopes[pluginId]);
  pluginScopeModels.value = {
    ...pluginScopeModels.value,
    [pluginId]: seeded,
  };
  return seeded;
}

function getPluginScopeMode(pluginId: string): PluginRenderScope['mode'] {
  return ensurePluginScopeModel(pluginId).mode;
}

function setPluginScopeMode(pluginId: string, mode: PluginRenderScope['mode']): void {
  const existing = ensurePluginScopeModel(pluginId);
  pluginScopeModels.value = {
    ...pluginScopeModels.value,
    [pluginId]: {
      ...existing,
      mode,
      eggIds: mode === 'global' ? [] : existing.eggIds,
    },
  };
}

function getPluginScopeEggIds(pluginId: string): string[] {
  return ensurePluginScopeModel(pluginId).eggIds;
}

function setPluginScopeEggIds(pluginId: string, eggIds: string[]): void {
  const existing = ensurePluginScopeModel(pluginId);
  pluginScopeModels.value = {
    ...pluginScopeModels.value,
    [pluginId]: {
      ...existing,
      eggIds,
    },
  };
}

watch(
  [summary, pluginScopeSummary],
  () => {
    const nextModels: Record<string, PluginRenderScope> = {};
    const nextDetailsOpen: Record<string, boolean> = {};
    for (const plugin of summary.value.plugins) {
      const existing = pluginScopeModels.value[plugin.id];
      nextModels[plugin.id] = existing
        ? normalizePluginScopeForSave(existing)
        : clonePluginScope(pluginScopeSummary.value.scopes[plugin.id]);

      nextDetailsOpen[plugin.id] = pluginDetailsOpen.value[plugin.id] ?? false;
    }
    pluginScopeModels.value = nextModels;
    pluginDetailsOpen.value = nextDetailsOpen;
  },
  { immediate: true },
);

async function refreshPluginData(): Promise<void> {
  await Promise.all([refresh(), refreshPluginScopes(), refreshNuxtData('plugin-contributions')]);
}

function isPluginScopeSaving(pluginId: string): boolean {
  return Boolean(pluginScopeSaving.value[pluginId]);
}

function isPluginDetailsOpen(pluginId: string): boolean {
  return Boolean(pluginDetailsOpen.value[pluginId]);
}

async function savePluginScope(pluginId: string): Promise<void> {
  const scopeModel = ensurePluginScopeModel(pluginId);
  const payload = normalizePluginScopeForSave(scopeModel);

  if (payload.mode === 'eggs' && payload.eggIds.length === 0) {
    toast.add({
      color: 'warning',
      title: 'Egg selection required',
      description: 'Choose at least one egg for egg-scoped mode.',
    });
    return;
  }

  pluginScopeSaving.value = {
    ...pluginScopeSaving.value,
    [pluginId]: true,
  };

  try {
    const response = (await ($fetch as unknown as (url: string, init?: unknown) => Promise<unknown>)(
      `/api/admin/plugins/${encodeURIComponent(pluginId)}/scope`,
      {
        method: 'PATCH',
        body: payload,
      },
    )) as { data: PluginScopeUpdateResponseData };

    pluginScopeModels.value = {
      ...pluginScopeModels.value,
      [pluginId]: clonePluginScope(response.data.scope),
    };

    toast.add({
      color: 'success',
      title: 'Plugin scope saved',
      description:
        response.data.scope.mode === 'global'
          ? 'Extension is now available on all eggs.'
          : `Extension is now restricted to ${response.data.scope.eggIds.length} egg(s).`,
    });

    await Promise.all([refreshPluginScopes(), refreshNuxtData('plugin-contributions')]);
  } catch (errorValue) {
    const message = normalizeInstallErrorMessage(errorValue);
    toast.add({
      color: 'error',
      title: 'Failed to save plugin scope',
      description: message,
    });
  } finally {
    pluginScopeSaving.value = {
      ...pluginScopeSaving.value,
      [pluginId]: false,
    };
  }
}

</script>

<template>
  <UPage>
    <UPageBody>
      <UContainer class="space-y-6">
        <UCard class="border-default/80 shadow-sm">
          <div class="space-y-4">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="text-base font-semibold">Plugin Runtime</h2>
                <p class="text-sm text-muted-foreground">
                  Plugin installation is managed on the panel host; this page only shows runtime and
                  scope state.
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge color="neutral" variant="soft" size="sm">
                  Plugin system v{{ pluginSystemVersion }}
                </UBadge>
              </div>
            </div>

            <div class="flex justify-end">
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="pending || pluginScopePending"
                @click="refreshPluginData"
              >
                Refresh data
              </UButton>
            </div>
          </div>
        </UCard>

        <div class="grid gap-4 md:grid-cols-3">
          <UCard class="border-default/80 bg-muted/10">
            <div class="flex items-center justify-between">
              <p class="text-xs uppercase tracking-wide text-muted-foreground">Discovered</p>
              <UIcon name="i-lucide-puzzle" class="size-4 text-primary" />
            </div>
            <p class="mt-3 text-2xl font-semibold">{{ pluginCount }}</p>
          </UCard>
          <UCard class="border-default/80 bg-muted/10">
            <div class="flex items-center justify-between">
              <p class="text-xs uppercase tracking-wide text-muted-foreground">Loaded</p>
              <UIcon name="i-lucide-check-circle-2" class="size-4 text-success" />
            </div>
            <p class="mt-3 text-2xl font-semibold text-success">{{ loadedCount }}</p>
          </UCard>
          <UCard class="border-default/80 bg-muted/10">
            <div class="flex items-center justify-between">
              <p class="text-xs uppercase tracking-wide text-muted-foreground">Failed</p>
              <UIcon name="i-lucide-alert-triangle" class="size-4 text-error" />
            </div>
            <p class="mt-3 text-2xl font-semibold" :class="failedCount > 0 ? 'text-error' : ''">
              {{ failedCount }}
            </p>
          </UCard>
        </div>

        <UAlert
          v-if="summary.discoveryErrors.length > 0"
          color="warning"
          icon="i-lucide-alert-triangle"
          title="Plugin discovery warnings"
          :description="`${summary.discoveryErrors.length} issue(s) were found while scanning manifests.`"
          variant="soft"
        />

        <UCard v-if="pending && summary.plugins.length === 0" :ui="{ body: 'space-y-3' }">
          <USkeleton v-for="i in 4" :key="`plugin-skeleton-${i}`" class="h-20 w-full rounded-lg" />
        </UCard>

        <UAlert
          v-else-if="error"
          color="error"
          icon="i-lucide-octagon-alert"
          title="Failed to load plugins"
          :description="(error as Error).message"
        >
          <template #actions>
            <UButton
              color="error"
              variant="soft"
              icon="i-lucide-refresh-cw"
              @click="() => { void refresh(); }"
            >
              Retry
            </UButton>
          </template>
        </UAlert>

        <UCard v-else-if="summary.plugins.length === 0" :ui="{ body: 'space-y-3' }">
          <UEmpty
            icon="i-lucide-puzzle"
            title="You have no plugins"
            description="Install a plugin via the panel host CLI, then refresh this page."
          />
        </UCard>

        <div v-else class="space-y-4">
          <UCard
            v-for="plugin in summary.plugins"
            :key="plugin.id"
            class="border-default/80 shadow-sm"
            :ui="{ body: 'p-0' }"
          >
            <UCollapsible v-model:open="pluginDetailsOpen[plugin.id]" :unmount-on-hide="false">
              <template #default>
                <div class="flex w-full items-start justify-between gap-3 p-4 cursor-pointer">
                  <div class="space-y-2 min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <UIcon name="i-lucide-puzzle" class="size-4 text-primary" />
                      <h2 class="text-base font-semibold">{{ plugin.name }}</h2>
                      <UBadge size="sm" variant="soft" color="neutral">{{ plugin.version }}</UBadge>
                      <UBadge color="neutral" variant="subtle" size="sm">
                        Hooks: {{ plugin.hooks.length }}
                      </UBadge>
                      <UBadge
                        v-if="plugin.errors.length > 0"
                        color="error"
                        variant="subtle"
                        size="sm"
                      >
                        Errors: {{ plugin.errors.length }}
                      </UBadge>
                    </div>
                    <p class="text-xs font-mono text-muted-foreground">{{ plugin.id }}</p>
                    <p v-if="plugin.description" class="text-sm text-muted-foreground truncate">
                      {{ plugin.description }}
                    </p>
                  </div>

                  <div class="flex items-center gap-2 shrink-0" @click.stop>
                    <UBadge
                      size="sm"
                      :color="plugin.enabled ? 'primary' : 'neutral'"
                      variant="subtle"
                    >
                      {{ plugin.enabled ? 'Enabled' : 'Disabled' }}
                    </UBadge>
                    <UBadge
                      size="sm"
                      :color="plugin.loaded ? 'success' : plugin.enabled ? 'error' : 'neutral'"
                      variant="subtle"
                    >
                      {{ plugin.loaded ? 'Loaded' : plugin.enabled ? 'Failed' : 'Skipped' }}
                    </UBadge>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :icon="
                        isPluginDetailsOpen(plugin.id)
                          ? 'i-lucide-chevron-up'
                          : 'i-lucide-chevron-down'
                      "
                      :aria-label="
                        isPluginDetailsOpen(plugin.id)
                          ? 'Collapse plugin details'
                          : 'Expand plugin details'
                      "
                      @click.stop="pluginDetailsOpen[plugin.id] = !pluginDetailsOpen[plugin.id]"
                    />
                  </div>
                </div>
              </template>

              <template #content>
                <div class="border-t border-default space-y-4 p-4">
                  <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div
                      class="rounded-lg border border-default/80 bg-muted/10 p-3 text-xs font-mono"
                    >
                      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Manifest
                      </p>
                      <p class="break-all">{{ plugin.manifestPath }}</p>
                    </div>
                    <div
                      class="rounded-lg border border-default/80 bg-muted/10 p-3 text-xs font-mono"
                    >
                      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Source
                      </p>
                      <p class="break-all">{{ plugin.sourceDir }}</p>
                    </div>
                    <div
                      v-if="plugin.serverEntryPath"
                      class="rounded-lg border border-default/80 bg-muted/10 p-3 text-xs font-mono"
                    >
                      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Server Entry
                      </p>
                      <p class="break-all">{{ plugin.serverEntryPath }}</p>
                    </div>
                    <div
                      v-if="plugin.moduleEntryPath"
                      class="rounded-lg border border-default/80 bg-muted/10 p-3 text-xs font-mono"
                    >
                      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Nuxt Module
                      </p>
                      <p class="break-all">{{ plugin.moduleEntryPath }}</p>
                    </div>
                    <div
                      v-if="plugin.nuxtLayerPath"
                      class="rounded-lg border border-default/80 bg-muted/10 p-3 text-xs font-mono"
                    >
                      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Nuxt Layer
                      </p>
                      <p class="break-all">{{ plugin.nuxtLayerPath }}</p>
                    </div>
                  </div>

                  <div class="space-y-3 rounded-xl border border-default/80 bg-muted/20 p-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p class="text-xs uppercase tracking-wide text-muted-foreground">
                          Extension Scope
                        </p>
                        <p class="text-xs text-muted-foreground">
                          Choose whether this plugin renders for all eggs or only selected eggs.
                        </p>
                      </div>

                      <UButton
                        size="xs"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-save"
                        :loading="isPluginScopeSaving(plugin.id) || pluginScopePending"
                        :disabled="pending || pluginScopePending"
                        @click="savePluginScope(plugin.id)"
                      >
                        Save scope
                      </UButton>
                    </div>

                    <UFormField label="Scope mode" name="scopeMode">
                      <USelect
                        :model-value="getPluginScopeMode(plugin.id)"
                        @update:model-value="(value) => setPluginScopeMode(plugin.id, value as PluginRenderScope['mode'])"
                        :items="scopeModeItems"
                        value-key="value"
                        aria-label="Plugin scope mode"
                        :disabled="isPluginScopeSaving(plugin.id) || pluginScopePending"
                      />
                    </UFormField>

                    <UFormField
                      v-if="getPluginScopeMode(plugin.id) === 'eggs'"
                      label="Egg visibility"
                      name="scopeEggs"
                    >
                      <USelect
                        :model-value="getPluginScopeEggIds(plugin.id)"
                        @update:model-value="(value) => setPluginScopeEggIds(plugin.id, value)"
                        :items="eggScopeOptions"
                        multiple
                        value-key="value"
                        placeholder="Select eggs that should render this extension"
                        aria-label="Plugin egg scope selection"
                        :disabled="isPluginScopeSaving(plugin.id) || pluginScopePending"
                      />
                    </UFormField>

                    <UAlert
                      v-if="getPluginScopeMode(plugin.id) === 'eggs' && getPluginScopeEggIds(plugin.id).length === 0"
                      color="warning"
                      variant="soft"
                      icon="i-lucide-triangle-alert"
                      title="No eggs selected"
                      description="Select at least one egg or switch back to global mode."
                    />
                  </div>

                  <div class="flex flex-wrap gap-2 text-xs">
                    <UBadge color="neutral" variant="subtle">
                      Admin Nav: {{ plugin.contributions.adminNavigation.length }}
                    </UBadge>
                    <UBadge color="neutral" variant="subtle">
                      Dashboard Nav: {{ plugin.contributions.dashboardNavigation.length }}
                    </UBadge>
                    <UBadge color="neutral" variant="subtle">
                      Server Nav: {{ plugin.contributions.serverNavigation.length }}
                    </UBadge>
                    <UBadge color="neutral" variant="subtle">
                      UI Slots: {{ plugin.contributions.uiSlots.length }}
                    </UBadge>
                  </div>

                  <UAlert
                    v-if="plugin.errors.length > 0"
                    color="error"
                    variant="soft"
                    icon="i-lucide-triangle-alert"
                    title="Plugin errors"
                    :description="plugin.errors.join('\n')"
                  />
                </div>
              </template>
            </UCollapsible>
          </UCard>
        </div>
      </UContainer>
    </UPageBody>

  </UPage>
</template>
