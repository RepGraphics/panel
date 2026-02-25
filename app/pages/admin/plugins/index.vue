<script setup lang="ts">
import type {
  PluginRenderScope,
  PluginRuntimeSummary,
  PluginScopeSummary,
} from '#shared/types/plugins';

interface PluginInstallResponseData {
  id: string;
  name: string;
  version: string;
  replaced: boolean;
  restartRequired: boolean;
  restartMode: 'not-required' | 'dev-reload-triggered' | 'process-restart-scheduled' | 'manual';
  restartAutomated: boolean;
  message: string;
}

interface PluginScopeUpdateResponseData {
  pluginId: string;
  scope: PluginRenderScope;
}

interface PluginStateUpdateResponseData {
  pluginId: string;
  enabled: boolean;
  restartRequired: boolean;
  restartMode: 'not-required' | 'dev-reload-triggered' | 'process-restart-scheduled' | 'manual';
  restartAutomated: boolean;
  message: string;
}

interface PluginUninstallResponseData {
  pluginId: string;
  pluginName: string;
  removed: boolean;
  restartRequired: boolean;
  restartMode: 'not-required' | 'dev-reload-triggered' | 'process-restart-scheduled' | 'manual';
  restartAutomated: boolean;
  message: string;
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
const installSectionOpen = ref(false);
const pluginDetailsOpen = ref<Record<string, boolean>>({});
const pluginStateBusy = ref<Record<string, boolean>>({});
const pluginUninstallBusy = ref<Record<string, boolean>>({});
const uninstallModalOpen = ref(false);
const uninstallTargetPluginId = ref<string | null>(null);
const uninstallTargetPluginName = ref('');

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

function isPluginStateBusy(pluginId: string): boolean {
  return Boolean(pluginStateBusy.value[pluginId]);
}

function isPluginUninstallBusy(pluginId: string): boolean {
  return Boolean(pluginUninstallBusy.value[pluginId]);
}

function isPluginScopeSaving(pluginId: string): boolean {
  return Boolean(pluginScopeSaving.value[pluginId]);
}

function isPluginDetailsOpen(pluginId: string): boolean {
  return Boolean(pluginDetailsOpen.value[pluginId]);
}

async function togglePluginEnabled(plugin: PluginRuntimeSummary['plugins'][number]): Promise<void> {
  if (isPluginStateBusy(plugin.id) || isPluginUninstallBusy(plugin.id)) {
    return;
  }

  const targetEnabled = !plugin.enabled;
  pluginStateBusy.value = {
    ...pluginStateBusy.value,
    [plugin.id]: true,
  };

  try {
    const response = await requestFetch<{ data: PluginStateUpdateResponseData }>(
      `/api/admin/plugins/${encodeURIComponent(plugin.id)}/state`,
      {
        method: 'PATCH',
        body: {
          enabled: targetEnabled,
          autoRestart: true,
        },
      },
    );

    const requiresManualRestart = response.data.restartRequired && !response.data.restartAutomated;
    installStatusMessage.value = response.data.message;
    installStatusWarning.value = requiresManualRestart;

    toast.add({
      color: requiresManualRestart ? 'warning' : 'success',
      title: targetEnabled ? `Enabled ${plugin.name}` : `Disabled ${plugin.name}`,
      description: response.data.message,
    });

    await refreshPluginData();
  } catch (errorValue) {
    const message = normalizeInstallErrorMessage(errorValue);
    toast.add({
      color: 'error',
      title: `Failed to ${targetEnabled ? 'enable' : 'disable'} plugin`,
      description: message,
    });
  } finally {
    pluginStateBusy.value = {
      ...pluginStateBusy.value,
      [plugin.id]: false,
    };
  }
}

function openUninstallModal(plugin: PluginRuntimeSummary['plugins'][number]): void {
  uninstallTargetPluginId.value = plugin.id;
  uninstallTargetPluginName.value = plugin.name;
  uninstallModalOpen.value = true;
}

function closeUninstallModal(): void {
  uninstallModalOpen.value = false;
  uninstallTargetPluginId.value = null;
  uninstallTargetPluginName.value = '';
}

async function confirmPluginUninstall(): Promise<void> {
  const pluginId = uninstallTargetPluginId.value;
  if (!pluginId) {
    return;
  }

  if (isPluginUninstallBusy(pluginId)) {
    return;
  }

  pluginUninstallBusy.value = {
    ...pluginUninstallBusy.value,
    [pluginId]: true,
  };

  try {
    const response = await requestFetch<{ data: PluginUninstallResponseData }>(
      `/api/admin/plugins/${encodeURIComponent(pluginId)}`,
      {
        method: 'DELETE',
        body: {
          autoRestart: true,
        },
      },
    );

    const requiresManualRestart = response.data.restartRequired && !response.data.restartAutomated;
    installStatusMessage.value = response.data.message;
    installStatusWarning.value = requiresManualRestart;

    toast.add({
      color: requiresManualRestart ? 'warning' : 'success',
      title: `Uninstalled ${response.data.pluginName}`,
      description: response.data.message,
    });

    closeUninstallModal();
    await refreshPluginData();
  } catch (errorValue) {
    const message = normalizeInstallErrorMessage(errorValue);
    toast.add({
      color: 'error',
      title: 'Plugin uninstall failed',
      description: message,
    });
  } finally {
    pluginUninstallBusy.value = {
      ...pluginUninstallBusy.value,
      [pluginId]: false,
    };
  }
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

    const requiresManualRestart = response.data.restartRequired && !response.data.restartAutomated;
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

    const requiresManualRestart = response.data.restartRequired && !response.data.restartAutomated;
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
        <UCard class="border-default/80">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div class="max-w-2xl space-y-2">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Plugins
              </p>
              <h2 class="text-xl font-semibold tracking-tight sm:text-2xl">Plugin Management</h2>
              <p class="text-sm text-muted-foreground">
                Install extensions, review load status, and control where each plugin renders.
              </p>
            </div>
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
        </UCard>

        <UCard class="border-default/80 shadow-sm" :ui="{ body: 'p-0' }">
          <UCollapsible v-model:open="installSectionOpen" :unmount-on-hide="false">
            <template #default>
              <div class="flex w-full items-center justify-between gap-3 p-4 sm:p-5 cursor-pointer">
                <div>
                  <h3 class="text-base font-semibold">Install Plugins</h3>
                  <p class="text-sm text-muted-foreground">
                    Install from a local path on the host or upload an archive.
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <UBadge color="primary" variant="soft" size="sm">Plugin installer</UBadge>
                  <UIcon
                    name="i-lucide-chevron-down"
                    class="size-4 text-muted-foreground transition-transform duration-200"
                    :class="{ 'rotate-180': installSectionOpen }"
                  />
                </div>
              </div>
            </template>

            <template #content>
              <div class="border-t border-default space-y-6 p-4 sm:p-5">
                <div class="grid gap-4 xl:grid-cols-2">
                  <div class="space-y-4 rounded-xl border border-default/80 bg-muted/20 p-4">
                    <div class="flex items-center gap-2 text-sm font-medium">
                      <UIcon name="i-lucide-folder-open" class="size-4 text-primary" />
                      Install from server path
                    </div>

                    <UFormField label="Source path" name="installSourcePath">
                      <UInput
                        v-model="installSourcePath"
                        placeholder="C:/plugins/my-plugin or /opt/plugins/my-plugin"
                        icon="i-lucide-folder-open"
                      />
                    </UFormField>

                    <UFormField
                      label="Manifest path (optional)"
                      name="installManifestPath"
                      help="Use this when plugin.json is not at the source root."
                    >
                      <UInput
                        v-model="installManifestPath"
                        placeholder="packages/plugin-a"
                        icon="i-lucide-file-code"
                      />
                    </UFormField>

                    <UButton
                      color="primary"
                      icon="i-lucide-download"
                      :loading="installBusyPath"
                      :disabled="installBusyArchive"
                      class="w-full justify-center"
                      @click="installFromPath"
                    >
                      Install from path
                    </UButton>
                  </div>

                  <div class="space-y-4 rounded-xl border border-default/80 bg-muted/20 p-4">
                    <div class="flex items-center gap-2 text-sm font-medium">
                      <UIcon name="i-lucide-upload" class="size-4 text-primary" />
                      Install from archive
                    </div>

                    <label
                      class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-default px-4 py-6 text-center transition hover:border-primary/50 hover:bg-muted/40"
                    >
                      <input
                        ref="archiveInputRef"
                        type="file"
                        accept=".zip,.tar,.tar.gz,.tgz"
                        class="hidden"
                        @change="onArchiveSelected"
                      />
                      <UIcon name="i-lucide-file-archive" class="size-5 text-primary" />
                      <p class="text-sm font-medium">
                        {{ selectedArchiveLabel || 'Choose plugin archive' }}
                      </p>
                      <p class="text-xs text-muted-foreground">
                        Accepted: .zip, .tar, .tar.gz, .tgz
                      </p>
                    </label>

                    <UFormField
                      label="Manifest path in archive (optional)"
                      name="installArchiveManifestPath"
                      help="Leave empty when plugin.json is at archive root."
                    >
                      <UInput
                        v-model="installArchiveManifestPath"
                        placeholder="packages/plugin-a"
                        icon="i-lucide-file-archive"
                      />
                    </UFormField>

                    <UButton
                      color="primary"
                      icon="i-lucide-upload"
                      :loading="installBusyArchive"
                      :disabled="installBusyPath"
                      class="w-full justify-center"
                      @click="installFromArchive"
                    >
                      Upload and install
                    </UButton>
                  </div>
                </div>

                <div class="grid gap-3 md:grid-cols-2">
                  <div class="rounded-lg border border-default/80 bg-muted/10 p-3">
                    <UCheckbox
                      v-model="installForce"
                      :disabled="installBusyPath || installBusyArchive"
                      label="Overwrite existing plugin with the same id"
                    />
                    <p class="mt-1 pl-6 text-xs text-muted-foreground">
                      Replaces the currently installed version.
                    </p>
                  </div>
                  <div class="rounded-lg border border-default/80 bg-muted/10 p-3">
                    <UCheckbox
                      v-model="installAutoRestart"
                      :disabled="installBusyPath || installBusyArchive"
                      label="Automatically apply layer changes after install"
                    />
                    <p class="mt-1 pl-6 text-xs text-muted-foreground">
                      Triggers reload or restart when runtime changes require it.
                    </p>
                  </div>
                </div>

                <UAlert
                  v-if="installStatusMessage"
                  :color="installStatusWarning ? 'warning' : 'success'"
                  :icon="installStatusWarning ? 'i-lucide-triangle-alert' : 'i-lucide-check-circle'"
                  title="Install status"
                  :description="installStatusMessage"
                  variant="soft"
                />
              </div>
            </template>
          </UCollapsible>
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
            <UButton color="error" variant="soft" icon="i-lucide-refresh-cw" @click="refresh">
              Retry
            </UButton>
          </template>
        </UAlert>

        <UCard v-else-if="summary.plugins.length === 0" :ui="{ body: 'space-y-3' }">
          <UEmpty
            icon="i-lucide-puzzle"
            title="No Plugins Found"
            description="No plugins detected. Add plugin manifests under extensions/*/plugin.json."
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
                      variant="soft"
                      :icon="plugin.enabled ? 'i-lucide-pause-circle' : 'i-lucide-play-circle'"
                      :loading="isPluginStateBusy(plugin.id)"
                      :disabled="
                        isPluginUninstallBusy(plugin.id) ||
                        isPluginScopeSaving(plugin.id) ||
                        pending ||
                        pluginScopePending
                      "
                      @click.stop="togglePluginEnabled(plugin)"
                    >
                      {{ plugin.enabled ? 'Disable' : 'Enable' }}
                    </UButton>
                    <UButton
                      size="xs"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      :loading="isPluginUninstallBusy(plugin.id)"
                      :disabled="isPluginStateBusy(plugin.id) || pending || pluginScopePending"
                      @click.stop="openUninstallModal(plugin)"
                    >
                      Uninstall
                    </UButton>
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
                        @click="savePluginScope(plugin.id)"
                      >
                        Save scope
                      </UButton>
                    </div>

                    <UFormField
                      v-if="pluginScopeModels[plugin.id]"
                      label="Scope mode"
                      name="scopeMode"
                    >
                      <USelect
                        v-model="pluginScopeModels[plugin.id].mode"
                        :items="scopeModeItems"
                        value-key="value"
                        aria-label="Plugin scope mode"
                        :disabled="isPluginScopeSaving(plugin.id) || pluginScopePending"
                      />
                    </UFormField>

                    <UFormField
                      v-if="
                        pluginScopeModels[plugin.id] && pluginScopeModels[plugin.id].mode === 'eggs'
                      "
                      label="Egg visibility"
                      name="scopeEggs"
                    >
                      <USelect
                        v-model="pluginScopeModels[plugin.id].eggIds"
                        :items="eggScopeOptions"
                        multiple
                        value-key="value"
                        placeholder="Select eggs that should render this extension"
                        aria-label="Plugin egg scope selection"
                        :disabled="isPluginScopeSaving(plugin.id) || pluginScopePending"
                      />
                    </UFormField>

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

    <UModal
      v-model:open="uninstallModalOpen"
      :title="
        uninstallTargetPluginName ? `Uninstall ${uninstallTargetPluginName}?` : 'Uninstall plugin?'
      "
      description="This permanently removes the plugin files from disk."
    >
      <template #body>
        <p class="text-sm text-muted-foreground">
          This action cannot be undone. Plugin scopes and runtime registrations will also be
          removed.
        </p>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="closeUninstallModal">Cancel</UButton>
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            :loading="
              uninstallTargetPluginId ? isPluginUninstallBusy(uninstallTargetPluginId) : false
            "
            @click="confirmPluginUninstall"
          >
            Uninstall plugin
          </UButton>
        </div>
      </template>
    </UModal>
  </UPage>
</template>
