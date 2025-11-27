<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { AccountActivityResponse } from '#shared/types/account'

definePageMeta({
  auth: true,
})

const {
  data: activityResponse,
  pending: loading,
  error: fetchError,
  refresh: refreshActivity,
} = await useFetch<AccountActivityResponse>('/api/account/activity', {
  key: 'account-activity',
})

let refreshInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  refreshInterval = setInterval(() => {
    refreshActivity()
  }, 30000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})

const entries = computed(() => activityResponse.value?.data ?? [])
const generatedAt = computed(() => activityResponse.value?.generatedAt ?? null)
const generatedAtDate = computed(() => (generatedAt.value ? new Date(generatedAt.value) : null))
const error = computed(() => {
  if (!fetchError.value) return null
  return fetchError.value instanceof Error ? fetchError.value.message : 'Failed to load account activity.'
})

const expandedEntries = ref<Set<string>>(new Set())
const toast = useToast()

function toggleEntry(id: string) {
  if (expandedEntries.value.has(id)) {
    expandedEntries.value.delete(id)
  } else {
    expandedEntries.value.add(id)
  }
}

function formatJson(data: Record<string, unknown> | null): string {
  if (!data) return 'null'
  return JSON.stringify(data, null, 2)
}

function getFullAuditData(entry: typeof entries.value[0]) {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    metadata: entry.metadata,
  }
}

async function copyJson(entry: typeof entries.value[0]) {
  const json = formatJson(getFullAuditData(entry))
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(json)
    } else {
      const textArea = document.createElement('textarea')
      textArea.value = json
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
    toast.add({
      title: 'Copied to clipboard',
      description: 'Audit log entry JSON has been copied.',
    })
  } catch (error) {
    toast.add({
      title: 'Failed to copy',
      description: error instanceof Error ? error.message : 'Unable to copy to clipboard.',
      color: 'error',
    })
  }
}

</script>

<template>
  <UPage>
    <UContainer>
      <UPageHeader title="Account activity">
        <template #description>
          <span>
            Personal actions you've taken across XyraPanel. Use this log to verify recent changes and sign-ins. Updated
            <NuxtTime
              v-if="generatedAtDate"
              :datetime="generatedAtDate"
              relative
              class="font-medium"
            />
            <span v-else>recently</span>
          </span>
        </template>
      </UPageHeader>
    </UContainer>

    <UPageBody>
      <UContainer>
        <UCard :ui="{ body: 'space-y-3' }">
          <template #header>
            <h2 class="text-lg font-semibold">Recent activity</h2>
          </template>

          <template v-if="loading">
            <div class="space-y-2">
              <USkeleton v-for="i in 5" :key="`activity-skeleton-${i}`" class="h-14 w-full" />
            </div>
          </template>
          <template v-else-if="error">
            <div class="rounded-lg border border-dashed border-default p-4 text-sm text-destructive">
              {{ error }}
            </div>
          </template>
          <UEmpty
            v-else-if="entries.length === 0"
            icon="i-lucide-activity"
            title="No activity yet"
            description="Your account activity will appear here"
            variant="subtle"
          />
          <template v-else>
            <div class="space-y-3">
              <div
                v-for="entry in entries"
                :key="entry.id"
                class="rounded-lg border border-default overflow-hidden"
              >
                <button
                  class="w-full flex flex-col gap-2 p-3 text-left hover:bg-elevated/50 transition-colors md:flex-row md:items-center md:justify-between"
                  @click="toggleEntry(entry.id)"
                >
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <p class="text-sm font-medium font-mono">{{ entry.action }}</p>
                      <UIcon
                        :name="expandedEntries.has(entry.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                        class="size-4 text-muted-foreground shrink-0"
                      />
                    </div>
                    <p v-if="entry.target && !entry.target.startsWith('user#')" class="text-xs text-muted-foreground mt-1">
                      {{ entry.target }}
                    </p>
                  </div>
                  <div class="text-xs text-muted-foreground shrink-0">
                    <NuxtTime :datetime="entry.occurredAt" relative />
                  </div>
                </button>
                
                <div
                  v-if="expandedEntries.has(entry.id)"
                  class="border-t border-default bg-muted/30 p-4"
                >
                  <div class="space-y-2">
                    <div class="flex items-center justify-between mb-2">
                      <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audit Log Entry</p>
                      <UButton
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-copy"
                        @click.stop="copyJson(entry)"
                      >
                        Copy JSON
                      </UButton>
                    </div>
                    <pre class="text-xs font-mono bg-default rounded-lg p-3 overflow-x-auto border border-default"><code>{{ formatJson(getFullAuditData(entry)) }}</code></pre>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </UCard>
      </UContainer>
    </UPageBody>
  </UPage>
</template>
