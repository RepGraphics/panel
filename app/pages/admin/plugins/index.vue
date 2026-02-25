<script setup lang="ts">
import type { PluginRenderScope, PluginRuntimeSummary, PluginScopeSummary } from '#shared/types/plugins';

interface PluginInstallResponseData {
  id: string;
  name: string;
  version: string;
  replaced: boolean;
  restartRequired: boolean;
  restartMode:
    | 'not-required'
    | 'dev-reload-triggered'
    | 'process-restart-scheduled'
    | 'manual';
  restartAutomated: boolean;
  message: string;
}

interface PluginScopeUpdateResponseData {
  pluginId: string;
  scope: PluginRenderScope;
}

definePageMeta({
  auth: true,
  adminTitle: 'Plugins',
  adminSubtitle: 'Installed plugin manifests and runtime status',
});

const requestFetch = useRequestFetch();
const toast = useToast();

const { data, pending, error, refresh } = await useAsyncData<PluginRuntimeSummary>(
  'admin-plugins-summary',
  async () => {
    const response = await requestFetch<{ data: PluginRuntimeSummary }>('/api/admin/plugins');
    return response.data;
  },
  {
    default: () => ({
      initialized: false,
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

const {
  data: pluginScopeSummary,
  pending: pluginScopePending,
  refresh: refreshPluginScopes,
} = await useAsyncData<PluginScopeSummary>(
  'admin-plugin-scopes',
  async () => {
    const response = await requestFetch<{ data: PluginScopeSummary }>('/api/admin/plugins/scopes');
    return response.data;
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
] as const;

const eggScopeOptions = computed(() =>
  pluginScopeSummary.value.eggs.map((egg) => ({
    value: egg.id,
    label: egg.nestName ? `${egg.nestName} - ${egg.name}` : egg.name,
  })),
);

const pluginScopeModels = ref<Record<string, PluginRenderScope>>({});
const pluginScopeSaving = ref<Record<string, boolean>>({});

const installSourcePath = ref('');
const installManifestPath = ref('');
const installArchiveManifestPath = ref('');
const installForce = ref(false);
const installAutoRestart = ref(true);
const installBusyPath = ref(false);
const installBusyArchive = ref(false);
const installStatusMessage = ref<string | null>(null);
const installStatusWarning = ref(false);
const archiveInputRef = ref<HTMLInputElement | null>(null);
const archiveFile = ref<File | null>(null);

const selectedArchiveLabel = computed(() => {
  if (!archiveFile.value) {
    return null;
  }

  const sizeInMb = archiveFile.value.size / (1024 * 1024);
  return `${archiveFile.value.name} (${sizeInMb.toFixed(2)} MB)`;
});

function normalizeInstallErrorMessage(errorValue: unknown): string {
  if (!errorValue) {
    return 'Plugin installation failed.';
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

  return 'Plugin installation failed.';
}

function onArchiveSelected(event: Event): void {
  const input = event.target as HTMLInputElement | null;
  const nextFile = input?.files?.[0] ?? null;
  archiveFile.value = nextFile;
}

function clearArchiveSelection(): void {
  archiveFile.value = null;
  if (archiveInputRef.value) {
    archiveInputRef.value.value = '';
  }
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

watch(
  [summary, pluginScopeSummary],
  () => {
    const nextModels: Record<string, PluginRenderScope> = {};
    for (const plugin of summary.value.plugins) {
      const existing = pluginScopeModels.value[plugin.id];
      nextModels[plugin.id] = existing
        ? normalizePluginScopeForSave(existing)
        : clonePluginScope(pluginScopeSummary.value.scopes[plugin.id]);
    }
    pluginScopeModels.value = nextModels;
  },
  { immediate: true },
);

async function refreshPluginData(): Promise<void> {
  await Promise.all([refresh(), refreshPluginScopes(), refreshNuxtData('plugin-contributions')]);
}

function isPluginScopeSaving(pluginId: string): boolean {
  return Boolean(pluginScopeSaving.value[pluginId]);
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
    const response = await requestFetch<{ data: PluginScopeUpdateResponseData }>(
      `/api/admin/plugins/${encodeURIComponent(pluginId)}/scope`,
      {
        method: 'PATCH',
        body: payload,
      },
    );

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

async function installFromPath(): Promise<void> {
  const sourcePath = installSourcePath.value.trim();
  if (!sourcePath) {
    toast.add({
      color: 'warning',
      title: 'Source path required',
      description: 'Enter a plugin source path before installing.',
    });
    return;
  }

  installBusyPath.value = true;
  installStatusMessage.value = null;

  try {
    const response = await requestFetch<{ data: PluginInstallResponseData }>(
      '/api/admin/plugins/install',
      {
        method: 'POST',
        body: {
          sourcePath,
          manifestPath: installManifestPath.value.trim() || undefined,
          force: installForce.value,
          autoRestart: installAutoRestart.value,
        },
      },
    );

    const requiresManualRestart =
      response.data.restartRequired && !response.data.restartAutomated;
    installStatusMessage.value = response.data.message;
    installStatusWarning.value = requiresManualRestart;

    toast.add({
      color: requiresManualRestart ? 'warning' : 'success',
      title: `Installed ${response.data.name}`,
      description: response.data.message,
    });

    await refreshPluginData();
  } catch (errorValue) {
    const message = normalizeInstallErrorMessage(errorValue);
    installStatusMessage.value = message;
    installStatusWarning.value = true;
    toast.add({
      color: 'error',
      title: 'Plugin install failed',
      description: message,
    });
  } finally {
    installBusyPath.value = false;
  }
}

async function installFromArchive(): Promise<void> {
  if (!archiveFile.value) {
    toast.add({
      color: 'warning',
      title: 'Archive required',
      description: 'Choose a plugin archive before uploading.',
    });
    return;
  }

  installBusyArchive.value = true;
  installStatusMessage.value = null;

  try {
    const formData = new FormData();
    formData.append('archive', archiveFile.value);
    formData.append('force', installForce.value ? 'true' : 'false');
    formData.append('autoRestart', installAutoRestart.value ? 'true' : 'false');

    const manifestPath = installArchiveManifestPath.value.trim();
    if (manifestPath.length > 0) {
      formData.append('manifestPath', manifestPath);
    }

    const response = await requestFetch<{ data: PluginInstallResponseData }>(
      '/api/admin/plugins/install',
      {
        method: 'POST',
        body: formData,
      },
    );

    const requiresManualRestart =
      response.data.restartRequired && !response.data.restartAutomated;
    installStatusMessage.value = response.data.message;
    installStatusWarning.value = requiresManualRestart;

    toast.add({
      color: requiresManualRestart ? 'warning' : 'success',
      title: `Installed ${response.data.name}`,
      description: response.data.message,
    });

    clearArchiveSelection();
    await refreshPluginData();
  } catch (errorValue) {
    const message = normalizeInstallErrorMessage(errorValue);
    installStatusMessage.value = message;
    installStatusWarning.value = true;
    toast.add({
      color: 'error',
      title: 'Plugin upload failed',
      description: message,
    });
  } finally {
    installBusyArchive.value = false;
  }
}
</script>

<template>
  <UPage>
    <UPageBody>
      <UContainer class="space-y-6">
        <UCard :ui="{ body: 'space-y-5' }">
          <div>
            <h2 class="text-base font-semibold">Install Plugin</h2>
            <p class="text-sm text-muted-foreground">
              Install from a server path or upload an archive directly from this page.
            </p>
          </div>

          <div class="grid gap-5 xl:grid-cols-2">
            <div class="space-y-3">
              <p class="text-xs uppercase tracking-wide text-muted-foreground">From server path</p>
              <UInput
                v-model="installSourcePath"
                placeholder="C:/plugins/my-plugin or /opt/plugins/my-plugin"
                icon="i-lucide-folder-open"
              />
              <UInput
                v-model="installManifestPath"
                placeholder="Optional manifestPath (example: packages/plugin-a)"
                icon="i-lucide-file-code"
              />
              <UButton
                color="primary"
                icon="i-lucide-download"
                :loading="installBusyPath"
                @click="installFromPath"
              >
                Install from path
              </UButton>
            </div>

            <div class="space-y-3">
              <p class="text-xs uppercase tracking-wide text-muted-foreground">From archive upload</p>
              <input
                ref="archiveInputRef"
                type="file"
                accept=".zip,.tar,.tar.gz,.tgz"
                class="block w-full cursor-pointer rounded-md border border-default bg-default px-3 py-2 text-sm text-muted-foreground"
                @change="onArchiveSelected"
              />
              <p v-if="selectedArchiveLabel" class="text-xs text-muted-foreground">
                Selected: {{ selectedArchiveLabel }}
              </p>
              <UInput
                v-model="installArchiveManifestPath"
                placeholder="Optional manifestPath inside archive"
                icon="i-lucide-file-archive"
              />
              <UButton
                color="primary"
                icon="i-lucide-upload"
                :loading="installBusyArchive"
                @click="installFromArchive"
              >
                Upload and install
              </UButton>
            </div>
          </div>

          <label class="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              v-model="installForce"
              type="checkbox"
              class="size-4 rounded border-default text-primary focus:ring-primary"
            />
            Overwrite existing plugin with the same id
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              v-model="installAutoRestart"
              type="checkbox"
              class="size-4 rounded border-default text-primary focus:ring-primary"
            />
            Automatically apply layer changes after install
          </label>

          <UAlert
            v-if="installStatusMessage"
            :color="installStatusWarning ? 'warning' : 'success'"
            :icon="installStatusWarning ? 'i-lucide-triangle-alert' : 'i-lucide-check-circle'"
            title="Install status"
            :description="installStatusMessage"
          />
        </UCard>

        <div class="grid gap-4 md:grid-cols-3">
          <UCard>
            <p class="text-xs uppercase tracking-wide text-muted-foreground">Discovered</p>
            <p class="mt-2 text-2xl font-semibold">{{ pluginCount }}</p>
          </UCard>
          <UCard>
            <p class="text-xs uppercase tracking-wide text-muted-foreground">Loaded</p>
            <p class="mt-2 text-2xl font-semibold text-success">{{ loadedCount }}</p>
          </UCard>
          <UCard>
            <p class="text-xs uppercase tracking-wide text-muted-foreground">Failed</p>
            <p class="mt-2 text-2xl font-semibold" :class="failedCount > 0 ? 'text-error' : ''">
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
        />

        <UCard v-if="pending && summary.plugins.length === 0">
          <div class="space-y-3">
            <USkeleton
              v-for="i in 4"
              :key="`plugin-skeleton-${i}`"
              class="h-20 w-full rounded-lg"
            />
          </div>
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
              @click="() => refresh()"
            >
              Retry
            </UButton>
          </template>
        </UAlert>

        <UCard v-else-if="summary.plugins.length === 0" :ui="{ body: 'space-y-3' }">
          <p class="text-sm text-muted-foreground">
            No plugins detected. Add plugin manifests under <code>extensions/*/plugin.json</code>.
          </p>
        </UCard>

        <div v-else class="space-y-4">
          <UCard
            v-for="plugin in summary.plugins"
            :key="plugin.id"
            :ui="{ body: 'space-y-4' }"
            class="border-default/80"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-base font-semibold">{{ plugin.name }}</h2>
                  <UBadge size="sm" variant="soft" color="neutral">{{ plugin.version }}</UBadge>
                </div>
                <p class="text-xs text-muted-foreground font-mono">{{ plugin.id }}</p>
              </div>

              <div class="flex items-center gap-2">
                <UBadge size="sm" :color="plugin.enabled ? 'primary' : 'neutral'" variant="subtle">
                  {{ plugin.enabled ? 'Enabled' : 'Disabled' }}
                </UBadge>
                <UBadge
                  size="sm"
                  :color="plugin.loaded ? 'success' : plugin.enabled ? 'error' : 'neutral'"
                  variant="subtle"
                >
                  {{ plugin.loaded ? 'Loaded' : plugin.enabled ? 'Failed' : 'Skipped' }}
                </UBadge>
              </div>
            </div>

            <p v-if="plugin.description" class="text-sm text-muted-foreground">
              {{ plugin.description }}
            </p>

            <div class="grid gap-3 md:grid-cols-2">
              <div class="rounded-md border border-default p-3 text-xs font-mono">
                <p class="text-muted-foreground mb-1">Manifest</p>
                <p class="break-all">{{ plugin.manifestPath }}</p>
              </div>
              <div class="rounded-md border border-default p-3 text-xs font-mono">
                <p class="text-muted-foreground mb-1">Source</p>
                <p class="break-all">{{ plugin.sourceDir }}</p>
              </div>
              <div
                v-if="plugin.serverEntryPath"
                class="rounded-md border border-default p-3 text-xs font-mono"
              >
                <p class="text-muted-foreground mb-1">Server Entry</p>
                <p class="break-all">{{ plugin.serverEntryPath }}</p>
              </div>
              <div
                v-if="plugin.moduleEntryPath"
                class="rounded-md border border-default p-3 text-xs font-mono"
              >
                <p class="text-muted-foreground mb-1">Nuxt Module</p>
                <p class="break-all">{{ plugin.moduleEntryPath }}</p>
              </div>
              <div
                v-if="plugin.nuxtLayerPath"
                class="rounded-md border border-default p-3 text-xs font-mono"
              >
                <p class="text-muted-foreground mb-1">Nuxt Layer</p>
                <p class="break-all">{{ plugin.nuxtLayerPath }}</p>
              </div>
            </div>

            <div class="rounded-md border border-default p-3 space-y-3">
              <div class="flex items-center justify-between gap-3">
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
                  @click="savePluginScope(plugin.id)"
                >
                  Save scope
                </UButton>
              </div>

              <USelect
                v-if="pluginScopeModels[plugin.id]"
                v-model="pluginScopeModels[plugin.id].mode"
                :items="scopeModeItems"
                value-key="value"
                aria-label="Plugin scope mode"
                :disabled="isPluginScopeSaving(plugin.id) || pluginScopePending"
              />

              <USelect
                v-if="
                  pluginScopeModels[plugin.id] && pluginScopeModels[plugin.id].mode === 'eggs'
                "
                v-model="pluginScopeModels[plugin.id].eggIds"
                :items="eggScopeOptions"
                multiple
                value-key="value"
                placeholder="Select eggs that should render this extension"
                aria-label="Plugin egg scope selection"
                :disabled="isPluginScopeSaving(plugin.id) || pluginScopePending"
              />

              <UAlert
                v-if="
                  pluginScopeModels[plugin.id] &&
                  pluginScopeModels[plugin.id].mode === 'eggs' &&
                  pluginScopeModels[plugin.id].eggIds.length === 0
                "
                color="warning"
                variant="soft"
                icon="i-lucide-triangle-alert"
                title="No eggs selected"
                description="Select at least one egg or switch back to global mode."
              />
            </div>

            <div class="flex flex-wrap gap-2 text-xs">
              <UBadge color="neutral" variant="subtle"> Hooks: {{ plugin.hooks.length }} </UBadge>
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
          </UCard>
        </div>
      </UContainer>
    </UPageBody>
  </UPage>
</template>
