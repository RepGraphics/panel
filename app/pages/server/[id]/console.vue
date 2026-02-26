<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useClipboard } from '@vueuse/core';
import type { PowerAction, PanelServerDetails } from '#shared/types/server';
import { useAuthStore } from '~/stores/auth';
import PluginOutlet from '~/components/plugins/PluginOutlet.vue';

const route = useRoute();

definePageMeta({
  auth: true,
});

const { t } = useI18n();
const toast = useToast();
const serverId = computed(() => route.params.id as string);
const { data: pluginContributions } = await usePluginContributions({ serverId: serverId.value });
const pluginContext = computed(() => ({ route: route.path, serverId: serverId.value }));

const { data: serverResponse } = await useFetch(`/api/client/servers/${serverId.value}`, {
  watch: [serverId],
  key: `server-${serverId.value}`,
  immediate: true,
});
const serverData = computed(() => serverResponse.value as { data: PanelServerDetails } | null);

const server = computed(() => serverData.value?.data ?? null);
const primaryAllocation = computed(() => {
  return server.value?.allocations?.primary ?? null;
});
const serverLimits = computed(() => server.value?.limits ?? null);

const authStore = useAuthStore();
const { user: sessionUser, isAdmin } = storeToRefs(authStore);
const currentUserId = computed(() => sessionUser.value?.id ?? null);
const serverPermissions = computed(() => server.value?.permissions ?? []);
const adminServerPath = computed(() => {
  const id = server.value?.id?.trim();
  return id ? `/admin/servers/${id}` : null;
});
const canOpenAdminPanelServer = computed(() => Boolean(isAdmin.value && adminServerPath.value));

const { copy, copied } = useClipboard();
const serverAddress = computed(() => {
  if (!primaryAllocation.value) return '';
  return `${primaryAllocation.value.ip}:${primaryAllocation.value.port}`;
});

const {
  connected,
  serverState,
  stats,
  statsHistory,
  logs,
  error: wsError,
  sendCommand,
  sendPowerAction,
  reconnect,
  lifecycleStatus,
} = useServerWebSocket(serverId);

const showStats = ref(true);
const terminalRef = ref<{
  search?: (term: string) => void;
  clear?: () => void;
  downloadLogs?: () => void;
  scrollToBottom?: () => void;
} | null>(null);

const canSendCommands = computed(() => {
  const perms = serverPermissions.value;
  const ownerId = server.value?.owner?.id ?? null;
  const currentUser = currentUserId.value;
  const isOwner = Boolean(ownerId && currentUser && ownerId === currentUser);

  if (isAdmin.value || isOwner) {
    return true;
  }

  return perms.includes('control.console') || perms.includes('*');
});

const commandInput = ref('');
const commandHistory = ref<string[]>([]);
const historyIndex = ref(-1);

interface MinecraftEulaStatusResponse {
  data: {
    supported: boolean;
    likelyMinecraft: boolean;
    fileExists: boolean;
    accepted: boolean | null;
    requiresAcceptance: boolean;
    filePath: string;
  };
}

const eulaModalOpen = ref(false);
const eulaCheckInFlight = ref(false);
const eulaUpdateInFlight = ref(false);
const eulaLikelyMinecraft = ref(false);
const eulaRequiresAcceptance = ref(false);
const eulaAccepted = ref<boolean | null>(null);
const eulaLastCheckAt = ref<number | null>(null);
const eulaPendingStart = ref(false);

const EULA_HINT_REGEX = /you need to agree to the eula|eula\.txt|aka\.ms\/minecraft/i;

if (import.meta.client) {
  try {
    const stored = localStorage.getItem(`server-${serverId.value}:command_history`);
    if (stored) {
      commandHistory.value = JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[Console] Failed to load command history:', e);
  }
}

function saveHistory() {
  if (import.meta.client) {
    try {
      localStorage.setItem(
        `server-${serverId.value}:command_history`,
        JSON.stringify(commandHistory.value),
      );
    } catch (e) {
      console.warn('[Console] Failed to save command history:', e);
    }
  }
}

function addCommandToHistory(command: string) {
  if (!command.trim()) return;

  const index = commandHistory.value.indexOf(command);
  if (index > -1) {
    commandHistory.value.splice(index, 1);
  }

  commandHistory.value.unshift(command);
  if (commandHistory.value.length > 32) {
    commandHistory.value = commandHistory.value.slice(0, 32);
  }
  saveHistory();
}

function stripAnsi(value: string): string {
  return value.replaceAll('\u001b', '');
}

async function checkMinecraftEula(force = false): Promise<boolean> {
  if (!serverId.value || eulaCheckInFlight.value) {
    return eulaRequiresAcceptance.value;
  }

  const now = Date.now();
  if (!force && eulaLastCheckAt.value && now - eulaLastCheckAt.value < 3000) {
    return eulaRequiresAcceptance.value;
  }

  eulaCheckInFlight.value = true;

  try {
    const response = await $fetch<MinecraftEulaStatusResponse>(
      `/api/client/servers/${serverId.value}/minecraft/eula`,
    );
    const payload = response.data;

    eulaLikelyMinecraft.value = payload.likelyMinecraft || payload.fileExists;
    eulaAccepted.value = payload.accepted;
    eulaRequiresAcceptance.value = Boolean(payload.requiresAcceptance);

    if (eulaRequiresAcceptance.value && !eulaModalOpen.value) {
      eulaModalOpen.value = true;
    }

    return eulaRequiresAcceptance.value;
  } catch (error) {
    console.warn('[Console] Failed to check Minecraft EULA status:', error);
    return eulaRequiresAcceptance.value;
  } finally {
    eulaCheckInFlight.value = false;
    eulaLastCheckAt.value = Date.now();
  }
}

async function setMinecraftEulaAccepted(accepted: boolean) {
  if (eulaUpdateInFlight.value) {
    return;
  }

  eulaUpdateInFlight.value = true;
  try {
    await $fetch(`/api/client/servers/${serverId.value}/minecraft/eula`, {
      method: 'POST',
      body: { accepted },
    });

    eulaAccepted.value = accepted;
    eulaRequiresAcceptance.value = !accepted;
    eulaModalOpen.value = false;

    if (accepted) {
      toast.add({
        title: t('server.console.eula.acceptedTitle'),
        description: t('server.console.eula.acceptedDescription'),
        color: 'success',
      });

      if (eulaPendingStart.value) {
        eulaPendingStart.value = false;
        sendPowerAction('start');
      }
    } else {
      eulaPendingStart.value = false;
      toast.add({
        title: t('server.console.eula.declinedTitle'),
        description: t('server.console.eula.declinedDescription'),
        color: 'warning',
      });
    }

    if (accepted) {
      await checkMinecraftEula(true);
    }
  } catch (error) {
    toast.add({
      title: t('server.console.eula.updateFailedTitle'),
      description:
        error instanceof Error ? error.message : t('server.console.eula.updateFailedDescription'),
      color: 'error',
    });
  } finally {
    eulaUpdateInFlight.value = false;
  }
}

function submitCommand(event?: Event) {
  event?.preventDefault();
  const command = commandInput.value.trim();
  if (!command) {
    return;
  }

  addCommandToHistory(command);
  handleCommand(command);
  commandInput.value = '';
  historyIndex.value = -1;
}

function handleCommandKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (commandHistory.value.length > 0) {
      historyIndex.value = Math.min(historyIndex.value + 1, commandHistory.value.length - 1);
      commandInput.value = commandHistory.value[historyIndex.value] || '';
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex.value > 0) {
      historyIndex.value = Math.max(historyIndex.value - 1, -1);
      const nextCommand =
        historyIndex.value >= 0 ? commandHistory.value[historyIndex.value] : undefined;
      commandInput.value = nextCommand ?? '';
    } else if (historyIndex.value === 0) {
      commandInput.value = '';
      historyIndex.value = -1;
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return `0 ${t('common.bytes')}`;
  const k = 1024;
  const sizes = [t('common.bytes'), t('common.kb'), t('common.mb'), t('common.gb'), t('common.tb')];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

const currentTime = ref(Date.now());
const lastStatsTime = ref<number | null>(null);
let uptimeInterval: ReturnType<typeof setInterval> | null = null;

watch(
  () => stats.value?.uptime,
  () => {
    if (stats.value?.uptime) {
      lastStatsTime.value = Date.now();
    }
  },
);

onMounted(() => {
  uptimeInterval = setInterval(() => {
    currentTime.value = Date.now();
  }, 1000);

  void checkMinecraftEula(true);
});

onUnmounted(() => {
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
});

watch(
  () => logs.value.length,
  () => {
    const recentLines = logs.value.slice(-8);
    const hasEulaHint = recentLines.some((line) => EULA_HINT_REGEX.test(stripAnsi(line)));
    if (hasEulaHint) {
      void checkMinecraftEula(true);
    }
  },
);

watch(
  () => serverState.value,
  (state, previous) => {
    if (state === 'offline' || (previous === 'starting' && state !== 'running')) {
      void checkMinecraftEula(true);
    }
  },
);

watch(
  () => lifecycleStatus.value,
  (status, previous) => {
    if (previous === 'installing' && status === 'normal') {
      void checkMinecraftEula(true);
    }
  },
);

const formattedUptime = computed(() => {
  if (!stats.value || !stats.value.uptime || !lastStatsTime.value) return '00:00:00';

  const baseUptimeMs = stats.value.uptime;
  const elapsedSinceUpdate = currentTime.value - lastStatsTime.value;
  const totalUptimeMs = baseUptimeMs + elapsedSinceUpdate;

  // Convert to seconds
  const totalSeconds = Math.floor(totalUptimeMs / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
});

function getStateColor(state: string): 'primary' | 'success' | 'warning' | 'error' {
  switch (state) {
    case 'running':
      return 'success';
    case 'starting':
      return 'warning';
    case 'stopping':
      return 'warning';
    case 'offline':
      return 'error';
    default:
      return 'primary';
  }
}

function getStateIcon(state: string): string {
  switch (state) {
    case 'running':
      return 'i-lucide-circle-check';
    case 'starting':
      return 'i-lucide-loader-2';
    case 'stopping':
      return 'i-lucide-loader-2';
    case 'offline':
      return 'i-lucide-circle-x';
    default:
      return 'i-lucide-circle';
  }
}

function handleCommand(command: string) {
  if (!command.trim()) {
    return;
  }

  if (!connected.value) {
    return;
  }

  sendCommand(command);
}

async function handlePowerAction(action: PowerAction) {
  if (!connected.value) return;

  if (action === 'start') {
    const requiresAcceptance = await checkMinecraftEula(true);
    if (requiresAcceptance) {
      eulaPendingStart.value = true;
      eulaModalOpen.value = true;
      return;
    }
  }

  sendPowerAction(action);
}

function handleSearch() {
  if (!import.meta.client) return;
  const term =
    typeof globalThis !== 'undefined' && 'prompt' in globalThis
      ? (globalThis as { prompt?: (message: string) => string | null }).prompt?.(
          t('server.console.search'),
        )
      : null;
  if (term) {
    terminalRef.value?.search?.(term);
  }
}
</script>

<template>
  <UPage>
    <UPageBody>
      <UContainer>
        <ServerStatusBanner
          :is-installing="lifecycleStatus === 'installing' || server?.status === 'installing'"
          :is-transferring="lifecycleStatus === 'transferring'"
          :is-suspended="server?.suspended === true"
          :is-node-under-maintenance="false"
        />

        <div class="space-y-4">
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex items-center gap-2">
              <PluginOutlet
                name="server.console.power-buttons.before"
                :server-id="serverId"
                :contributions="pluginContributions"
                :context="pluginContext"
              />
              <UButton
                icon="i-lucide-play"
                color="success"
                size="sm"
                :disabled="!connected || serverState === 'running' || serverState === 'starting'"
                @click="() => handlePowerAction('start')"
              >
                {{ t('server.console.start') }}
              </UButton>
              <UButton
                icon="i-lucide-rotate-cw"
                color="warning"
                size="sm"
                :disabled="!connected || serverState !== 'running'"
                @click="() => handlePowerAction('restart')"
              >
                {{ t('server.console.restart') }}
              </UButton>
              <UButton
                icon="i-lucide-square"
                color="error"
                size="sm"
                :disabled="!connected || serverState === 'offline' || serverState === 'stopping'"
                @click="() => handlePowerAction('stop')"
              >
                {{ t('server.console.stop') }}
              </UButton>
              <UButton
                icon="i-lucide-zap-off"
                color="error"
                variant="ghost"
                size="sm"
                :disabled="!connected || serverState === 'offline'"
                @click="() => handlePowerAction('kill')"
              >
                {{ t('server.console.kill') }}
              </UButton>
              <PluginOutlet
                name="server.console.power-buttons.after"
                :server-id="serverId"
                :contributions="pluginContributions"
                :context="pluginContext"
              />
              <UButton
                v-if="canOpenAdminPanelServer && adminServerPath"
                icon="i-lucide-square-arrow-out-up-right"
                color="neutral"
                variant="soft"
                size="sm"
                :to="adminServerPath"
              >
                Open in Admin Panel
              </UButton>
            </div>

            <div class="flex items-center gap-3">
              <UBadge v-if="!connected" color="error" size="sm">
                <UIcon name="i-lucide-wifi-off" />
                <span class="ml-1">{{ t('server.console.disconnected') }}</span>
              </UBadge>
            </div>
          </div>

          <UAlert
            v-if="wsError && wsError !== 'Connecting...'"
            color="error"
            icon="i-lucide-alert-circle"
          >
            <template #title>{{ t('server.console.connectionLost') }}</template>
            <template #description>
              {{ wsError }}
            </template>
            <template #actions>
              <UButton color="error" variant="ghost" size="xs" @click="reconnect">
                {{ t('server.console.reconnect') }}
              </UButton>
            </template>
          </UAlert>

          <UAlert
            v-else-if="!connected && (!wsError || wsError === 'Connecting...')"
            color="warning"
            icon="i-lucide-wifi-off"
          >
            <template #title>{{ t('server.console.connecting') }}</template>
            <template #description>
              {{ t('server.console.connecting') }}
            </template>
          </UAlert>

          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-semibold">{{ t('server.console.title') }}</h2>
                <div class="flex items-center gap-2">
                  <UButton
                    icon="i-lucide-bar-chart-3"
                    size="xs"
                    variant="ghost"
                    :color="showStats ? 'primary' : 'neutral'"
                    @click="showStats = !showStats"
                  >
                    {{ t('server.console.stats') }}
                  </UButton>
                </div>
              </div>
            </template>

            <div class="relative h-125 overflow-hidden rounded-md bg-black">
              <div class="absolute top-2 right-2 z-10 flex gap-2">
                <UButton
                  icon="i-lucide-search"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :title="t('server.console.searchInConsole')"
                  @click="handleSearch"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :title="t('server.console.clearConsole')"
                  @click="() => terminalRef?.clear?.()"
                />
                <UButton
                  icon="i-lucide-download"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :title="t('server.console.downloadLogs')"
                  @click="() => terminalRef?.downloadLogs?.()"
                />
                <UButton
                  icon="i-lucide-arrow-down"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :title="t('server.console.scrollToBottom')"
                  @click="() => terminalRef?.scrollToBottom?.()"
                />
              </div>
              <ClientOnly>
                <ServerXTerminal
                  ref="terminalRef"
                  :logs="logs"
                  :connected="connected"
                  :server-id="serverId"
                  @command="handleCommand"
                />
                <template #fallback>
                  <div class="flex h-full items-center justify-center text-muted-foreground">
                    <div class="text-center">
                      <UIcon name="i-lucide-terminal" class="mx-auto size-12 opacity-50" />
                      <p class="mt-2">{{ t('common.loading') }}</p>
                    </div>
                  </div>
                </template>
              </ClientOnly>
            </div>

            <div v-show="canSendCommands" class="border-t border-default p-3">
              <UChatPrompt
                v-model="commandInput"
                variant="soft"
                :placeholder="t('server.console.enterCommand')"
                :disabled="!connected"
                :rows="1"
                :autoresize="false"
                @submit="submitCommand"
                @keydown="handleCommandKeyDown"
              />
            </div>
          </UCard>

          <PluginOutlet
            name="server.console.between-terminal-and-stats"
            :server-id="serverId"
            :contributions="pluginContributions"
            :context="pluginContext"
          />
          <ServerStatsChart v-if="showStats && stats" :stats="stats" :history="statsHistory" />
          <PluginOutlet
            v-if="showStats && stats"
            name="server.console.after-stats"
            :server-id="serverId"
            :contributions="pluginContributions"
            :context="pluginContext"
          />
          <div class="lg:hidden">
            <UCard>
              <template #header>
                <h3 class="text-sm font-semibold">{{ t('server.console.connected') }}</h3>
              </template>

              <div class="space-y-3 text-xs">
                <PluginOutlet
                  name="server.console.stats-card.before"
                  :server-id="serverId"
                  :contributions="pluginContributions"
                  :context="pluginContext"
                />
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">{{ t('common.status') }}</span>
                  <UBadge :color="connected ? 'success' : 'error'" size="xs">
                    {{
                      connected ? t('server.console.connected') : t('server.console.disconnected')
                    }}
                  </UBadge>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">{{ t('common.status') }}</span>
                  <UBadge :color="getStateColor(serverState)" size="xs">
                    <UIcon
                      :name="getStateIcon(serverState)"
                      :class="{
                        'animate-spin': serverState === 'starting' || serverState === 'stopping',
                      }"
                    />
                    <span class="ml-1 capitalize">{{ serverState }}</span>
                  </UBadge>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-muted-foreground">{{ t('server.console.ipPort') }}</span>
                  <div v-if="primaryAllocation" class="flex items-center gap-1">
                    <span class="font-mono text-xs">{{ serverAddress }}</span>
                    <UTooltip :text="copied ? t('common.copied') : t('common.copy')">
                      <UButton
                        :color="copied ? 'success' : 'neutral'"
                        variant="link"
                        size="xs"
                        :icon="copied ? 'i-lucide-copy-check' : 'i-lucide-copy'"
                        :aria-label="t('common.copy')"
                        @click="copy(serverAddress)"
                      />
                    </UTooltip>
                  </div>
                  <span v-else class="text-muted-foreground">{{ t('common.notAssigned') }}</span>
                </div>
                <div v-if="stats && stats.uptime" class="flex items-center justify-between">
                  <span class="text-muted-foreground">{{ t('server.console.uptime') }}</span>
                  <span class="font-mono">{{ formattedUptime }}</span>
                </div>
                <div
                  v-if="stats && stats.cpuAbsolute !== undefined"
                  class="flex items-center justify-between"
                >
                  <span class="text-muted-foreground">{{ t('server.console.cpu') }}</span>
                  <span v-if="serverLimits?.cpu"
                    >{{ stats.cpuAbsolute.toFixed(2) }}% / {{ serverLimits.cpu }}%</span
                  >
                  <span v-else>{{ stats.cpuAbsolute.toFixed(2) }}%</span>
                </div>
                <div
                  v-if="stats && stats.memoryLimitBytes"
                  class="flex items-center justify-between"
                >
                  <span class="text-muted-foreground">{{ t('server.console.memory') }}</span>
                  <span
                    >{{ formatBytes(stats.memoryBytes) }} /
                    {{ formatBytes(stats.memoryLimitBytes) }}</span
                  >
                </div>
                <div v-if="stats && serverLimits?.disk" class="flex items-center justify-between">
                  <span class="text-muted-foreground">{{ t('server.console.disk') }}</span>
                  <span
                    >{{ formatBytes(stats.diskBytes) }} /
                    {{ formatBytes((serverLimits.disk || 0) * 1024 * 1024) }}</span
                  >
                </div>
                <div v-if="stats" class="flex items-center justify-between">
                  <span class="text-muted-foreground">{{ t('server.console.network') }}</span>
                  <span
                    >{{ formatBytes(stats.networkRxBytes) }} /
                    {{ formatBytes(stats.networkTxBytes) }}</span
                  >
                </div>
                <PluginOutlet
                  name="server.console.stats-card.after"
                  :server-id="serverId"
                  :contributions="pluginContributions"
                  :context="pluginContext"
                />
              </div>
            </UCard>
          </div>
        </div>
      </UContainer>
    </UPageBody>

    <UModal
      v-model:open="eulaModalOpen"
      :title="t('server.console.eula.modalTitle')"
      :description="t('server.console.eula.modalDescription')"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert color="warning" icon="i-lucide-alert-triangle">
            <template #title>{{ t('server.console.eula.alertTitle') }}</template>
            <template #description>
              <p class="text-sm">
                {{ t('server.console.eula.alertDescription') }}
              </p>
            </template>
          </UAlert>

          <p class="text-sm text-muted-foreground">
            <template v-if="eulaLikelyMinecraft">
              {{ t('server.console.eula.likelyMinecraftDescription') }}
            </template>
            <template v-else>
              {{ t('server.console.eula.genericDescription') }}
            </template>
          </p>

          <a
            href="https://aka.ms/MinecraftEULA"
            target="_blank"
            rel="noreferrer noopener"
            class="text-sm text-primary hover:underline"
          >
            {{ t('server.console.eula.readOfficialLink') }}
          </a>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            :loading="eulaUpdateInFlight"
            :disabled="eulaUpdateInFlight"
            @click="setMinecraftEulaAccepted(false)"
          >
            {{ t('server.console.eula.declineButton') }}
          </UButton>
          <UButton
            color="primary"
            :loading="eulaUpdateInFlight"
            :disabled="eulaUpdateInFlight"
            @click="setMinecraftEulaAccepted(true)"
          >
            {{ t('server.console.eula.acceptButton') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <template #right>
      <UPageAside class="hidden lg:block lg:min-w-88">
        <UCard>
          <template #header>
            <h3 class="text-sm font-semibold">{{ t('server.console.connected') }}</h3>
          </template>

          <div class="space-y-3 text-xs">
            <PluginOutlet
              name="server.console.stats-card.before"
              :server-id="serverId"
              :contributions="pluginContributions"
              :context="pluginContext"
            />
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">{{ t('common.status') }}</span>
              <UBadge :color="connected ? 'success' : 'error'" size="xs">
                {{ connected ? t('server.console.connected') : t('server.console.disconnected') }}
              </UBadge>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">{{ t('common.status') }}</span>
              <UBadge :color="getStateColor(serverState)" size="xs">
                <UIcon
                  :name="getStateIcon(serverState)"
                  :class="{
                    'animate-spin': serverState === 'starting' || serverState === 'stopping',
                  }"
                />
                <span class="ml-1 capitalize">{{ serverState }}</span>
              </UBadge>
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted-foreground">{{ t('server.console.ipPort') }}</span>
              <div v-if="primaryAllocation" class="flex items-center gap-1">
                <span class="font-mono text-xs">{{ serverAddress }}</span>
                <UTooltip :text="copied ? t('common.copied') : t('common.copy')">
                  <UButton
                    :color="copied ? 'success' : 'neutral'"
                    variant="link"
                    size="xs"
                    :icon="copied ? 'i-lucide-copy-check' : 'i-lucide-copy'"
                    :aria-label="t('common.copy')"
                    @click="copy(serverAddress)"
                  />
                </UTooltip>
              </div>
              <span v-else class="text-muted-foreground">{{ t('common.notAssigned') }}</span>
            </div>
            <div v-if="stats && stats.uptime" class="flex items-center justify-between">
              <span class="text-muted-foreground">{{ t('server.console.uptime') }}</span>
              <span class="font-mono">{{ formattedUptime }}</span>
            </div>
            <div
              v-if="stats && stats.cpuAbsolute !== undefined"
              class="flex items-center justify-between"
            >
              <span class="text-muted-foreground">{{ t('server.console.cpu') }}</span>
              <span v-if="serverLimits?.cpu"
                >{{ stats.cpuAbsolute.toFixed(2) }}% / {{ serverLimits.cpu }}%</span
              >
              <span v-else>{{ stats.cpuAbsolute.toFixed(2) }}%</span>
            </div>
            <div v-if="stats && stats.memoryLimitBytes" class="flex items-center justify-between">
              <span class="text-muted-foreground">{{ t('server.console.memory') }}</span>
              <span
                >{{ formatBytes(stats.memoryBytes) }} /
                {{ formatBytes(stats.memoryLimitBytes) }}</span
              >
            </div>
            <div v-if="stats && serverLimits?.disk" class="flex items-center justify-between">
              <span class="text-muted-foreground">{{ t('server.console.disk') }}</span>
              <span
                >{{ formatBytes(stats.diskBytes) }} /
                {{ formatBytes((serverLimits.disk || 0) * 1024 * 1024) }}</span
              >
            </div>
            <div v-if="stats" class="flex items-center justify-between">
              <span class="text-muted-foreground">{{ t('server.console.network') }}</span>
              <span
                >{{ formatBytes(stats.networkRxBytes) }} /
                {{ formatBytes(stats.networkTxBytes) }}</span
              >
            </div>
            <PluginOutlet
              name="server.console.stats-card.after"
              :server-id="serverId"
              :contributions="pluginContributions"
              :context="pluginContext"
            />
          </div>
        </UCard>
      </UPageAside>
    </template>
  </UPage>
</template>
