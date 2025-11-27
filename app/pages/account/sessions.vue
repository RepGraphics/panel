<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { authClient } from '~/utils/auth-client'
import type { AccountSessionsResponse, UserSessionSummary } from '#shared/types/auth'

definePageMeta({
  auth: true,
})

const sessions = ref<UserSessionSummary[]>([])
const sessionsError = ref<string | null>(null)
const currentSessionToken = ref<string | null>(null)
const updatingSessions = ref(false)

const hasSessions = computed(() => sessions.value.length > 0)
const toast = useToast()

const authStore = useAuthStore()
const { status } = storeToRefs(authStore)

const {
  data: sessionsResponse,
  pending: sessionsPending,
  error: sessionsFetchError,
  execute: fetchSessions,
  refresh: refreshSessions,
} = useLazyAsyncData('account-sessions', () => 
  $fetch<AccountSessionsResponse>('/api/account/sessions')
)

watch(sessionsResponse, (response) => {
  if (!response)
    return

  sessions.value = response.data
  currentSessionToken.value = response.currentToken
})

watch(sessionsFetchError, (err) => {
  if (!err) {
    sessionsError.value = null
    return
  }

  const message = err instanceof Error ? err.message : 'Unable to load sessions.'
  sessionsError.value = message
})

watch(status, async (newStatus) => {
  if (newStatus === 'authenticated') {
    if (!sessionsResponse.value && !sessionsPending.value) {
      await fetchSessions()
    }
  }

  if (newStatus === 'unauthenticated') {
    sessions.value = []
    currentSessionToken.value = null
    sessionsError.value = 'You need to sign in to view sessions.'
  }
}, { immediate: true })

onMounted(async () => {
  if (status.value === 'authenticated' && !sessionsResponse.value && !sessionsPending.value) {
    await fetchSessions()
  }
})

async function loadSessions() {
  await authStore.syncSession()
  await refreshSessions()
}

const sortedSessions = computed(() => (
  [...sessions.value].sort((a, b) => b.expiresAtTimestamp - a.expiresAtTimestamp)
))

const expandedSessions = ref<Set<string>>(new Set())

function toggleSession(token: string) {
  if (expandedSessions.value.has(token)) {
    expandedSessions.value.delete(token)
  } else {
    expandedSessions.value.add(token)
  }
}

function maskIp(ip: string) {
  if (!ip || ip === 'Unknown') return 'Unknown'
  return '**********'
}

function formatJson(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2)
}

function getFullSessionData(session: UserSessionSummary) {
  return {
    token: session.token,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    expiresAtTimestamp: session.expiresAtTimestamp,
    isCurrent: session.isCurrent,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    browser: session.browser,
    os: session.os,
    device: session.device,
    lastSeenAt: session.lastSeenAt,
    firstSeenAt: session.firstSeenAt,
    fingerprint: session.fingerprint,
  }
}

async function copyJson(session: UserSessionSummary) {
  const json = formatJson(getFullSessionData(session))
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
      description: 'Session data JSON has been copied.',
    })
  } catch (error) {
    toast.add({
      title: 'Failed to copy',
      description: error instanceof Error ? error.message : 'Unable to copy to clipboard.',
      color: 'error',
    })
  }
}

async function handleSignOut(token: string) {
  if (updatingSessions.value) return

  updatingSessions.value = true
  try {
    if (authClient.multiSession && typeof authClient.multiSession.revoke === 'function') {
      try {
        const result = await authClient.multiSession.revoke({
          sessionToken: token,
        })

        if (result?.error) {
          throw new Error(result.error.message || 'Failed to revoke session')
        }

        const currentSession = await authClient.getSession()
        const currentSessionRevoked = !currentSession?.data

        if (currentSessionRevoked) {
          await navigateTo('/auth/login')
          return
        }

        await loadSessions()
        toast.add({
          title: 'Session revoked',
          description: 'The selected session has been signed out.',
        })
        return
      }
      catch (err) {
        console.warn('Multi-session client revoke failed, falling back to API:', err)
      }
    }

    const result = await $fetch<{ revoked: boolean, currentSessionRevoked: boolean }>(`/api/account/sessions/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    })
    const currentSessionRevoked = result.currentSessionRevoked

    if (currentSessionRevoked) {
      await navigateTo('/auth/login')
      return
    }

    await loadSessions()
    toast.add({
      title: 'Session revoked',
      description: 'The selected session has been signed out.',
    })
  }
  catch (error) {
    toast.add({
      title: 'Failed to revoke session',
      description: error instanceof Error ? error.message : 'Unable to revoke selected session.',
      color: 'error',
    })
  }
  finally {
    updatingSessions.value = false
  }
}

async function handleSignOutAll(includeCurrent = false) {
  if (updatingSessions.value) return

  updatingSessions.value = true
  try {
    if (includeCurrent) {
      await authClient.signOut()
      await navigateTo('/auth/login')
      return
    }

    if (typeof authClient.revokeOtherSessions === 'function') {
      try {
        await authClient.revokeOtherSessions()
        await loadSessions()
        toast.add({
          title: 'Sessions revoked',
          description: 'All other sessions have been revoked.',
        })
        return
      }
      catch {
        // Error already handled by toast
      }
    }

    const result = await $fetch<{ revoked: number, currentSessionRevoked: boolean }>('/api/account/sessions', {
      method: 'DELETE',
      query: { includeCurrent: 'false' },
    })

    await loadSessions()
    toast.add({
      title: 'Sessions revoked',
      description: result.revoked > 0
        ? `Revoked ${result.revoked} session${result.revoked === 1 ? '' : 's'}.`
        : 'No sessions were revoked.',
    })
  }
  catch (error) {
    toast.add({
      title: 'Failed to revoke sessions',
      description: error instanceof Error ? error.message : 'Unable to revoke sessions.',
      color: 'error',
    })
  }
  finally {
    updatingSessions.value = false
  }
}
</script>

<template>
  <UPage>
    <UContainer>
      <UPageHeader
        title="Sessions"
        description="Manage devices currently authenticated with your XyraPanel account."
      >
        <template #links>
          <UButton
            variant="ghost"
            color="neutral"
            :loading="updatingSessions"
            :disabled="!hasSessions || updatingSessions"
            @click="handleSignOutAll(false)"
          >
            Sign out others
          </UButton>
          <UButton
            variant="soft"
            color="neutral"
            :loading="updatingSessions"
            :disabled="!hasSessions || updatingSessions"
            @click="handleSignOutAll(true)"
          >
            Sign out all
          </UButton>
        </template>
      </UPageHeader>
    </UContainer>

    <UPageBody>
      <UContainer>
        <UCard :ui="{ body: 'space-y-3' }">
          <template #header>
            <div>
              <h2 class="text-lg font-semibold">Active sessions</h2>
              <p class="text-sm text-muted-foreground">Browser tokens issued for your account.</p>
            </div>
          </template>

          <div v-if="sessionsPending" class="space-y-3">
            <USkeleton v-for="i in 3" :key="`session-skeleton-${i}`" class="h-16 w-full rounded-lg" />
          </div>
          <UAlert v-else-if="sessionsError" icon="i-lucide-alert-triangle" color="error" :title="sessionsError" />
          <UEmpty
            v-else-if="!hasSessions"
            icon="i-lucide-monitor"
            title="No active sessions"
            description="No browser sessions found for your account"
            variant="subtle"
          />
          <div v-else class="space-y-3">
            <div
              v-for="session in sortedSessions"
              :key="session.token"
              class="rounded-lg border border-default overflow-hidden"
            >
              <button
                class="w-full flex items-center gap-3 p-3 text-left hover:bg-elevated/50 transition-colors"
                @click="toggleSession(session.token)"
              >
                <UIcon
                  :name="session.device === 'Mobile' ? 'i-lucide-smartphone' : session.device === 'Tablet' ? 'i-lucide-tablet' : 'i-lucide-monitor'"
                  class="size-5 shrink-0 text-primary"
                />
                
                <div class="flex-1 min-w-0 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div class="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-sm font-medium">{{ session.device ?? 'Unknown' }}</span>
                      <UIcon
                        :name="expandedSessions.has(session.token) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                        class="size-4 text-muted-foreground shrink-0"
                      />
                    </div>
                    <span class="text-xs text-muted-foreground">{{ session.os ?? 'Unknown' }} • {{ session.browser ?? 'Unknown' }}</span>
                    <UBadge v-if="session.token === currentSessionToken" color="primary" variant="soft" size="xs" class="shrink-0">
                      Current
                    </UBadge>
                  </div>

                  <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs text-muted-foreground shrink-0">
                    <div class="flex items-center gap-1 shrink-0">
                      <span class="truncate">IP:</span>
                      <UTooltip
                        v-if="session.ipAddress && session.ipAddress !== 'Unknown'"
                        :delay-duration="0"
                        :text="session.ipAddress"
                      >
                        <span class="cursor-help font-mono">{{ maskIp(session.ipAddress) }}</span>
                      </UTooltip>
                      <span v-else class="font-mono">{{ maskIp(session.ipAddress ?? 'Unknown') }}</span>
                    </div>
                    <span class="hidden sm:inline">•</span>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="truncate">
                        Active:
                        <template v-if="session.lastSeenAt">
                          <NuxtTime :datetime="session.lastSeenAt" class="font-medium" />
                        </template>
                        <span v-else>Unknown</span>
                      </span>
                      <span class="hidden sm:inline">•</span>
                      <span class="truncate">
                        Expires:
                        <template v-if="session.expiresAtTimestamp">
                          <NuxtTime :datetime="session.expiresAtTimestamp * 1000" class="font-medium" />
                        </template>
                        <span v-else>Unknown</span>
                      </span>
                    </div>
                  </div>

                  <div class="flex items-center gap-2 shrink-0">
                    <UButton
                      variant="ghost"
                      color="error"
                      size="xs"
                      :loading="updatingSessions"
                      :disabled="session.token === currentSessionToken && updatingSessions"
                      @click.stop="handleSignOut(session.token)"
                    >
                      Revoke
                    </UButton>
                  </div>
                </div>
              </button>
              
              <div
                v-if="expandedSessions.has(session.token)"
                class="border-t border-default bg-muted/30 p-4"
              >
                <div class="space-y-2">
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Session Data</p>
                    <UButton
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-copy"
                      @click.stop="copyJson(session)"
                    >
                      Copy JSON
                    </UButton>
                  </div>
                  <pre class="text-xs font-mono bg-default rounded-lg p-3 overflow-x-auto border border-default"><code>{{ formatJson(getFullSessionData(session)) }}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </UContainer>
    </UPageBody>
  </UPage>
</template>
