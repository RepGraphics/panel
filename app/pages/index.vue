<template>
  <UPage>
    <UContainer>
      <UPageHeader
        :title="welcomeTitle"
        description="Manage your servers and recent activity from one place."
        :links="headerLinks"
      />
    </UContainer>

    <UPageBody>
      <UContainer class="space-y-8">
        <section>
          <h2 class="sr-only">Key metrics</h2>
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
            <template v-if="loading">
              <UCard v-for="i in 2" :key="`metric-skeleton-${i}`">
                <div class="space-y-3">
                  <USkeleton class="h-3 w-24" />
                  <USkeleton class="h-8 w-20" />
                  <USkeleton class="h-3 w-32" />
                </div>
              </UCard>
            </template>
            <template v-else-if="error">
              <UCard>
                <p class="text-sm text-destructive">{{ error }}</p>
              </UCard>
            </template>
            <template v-else-if="metrics.length === 0">
              <UCard>
                <p class="text-sm text-muted-foreground">No server statistics to show yet.</p>
              </UCard>
            </template>
            <template v-else>
              <UCard v-for="card in metrics" :key="card.key">
                <div class="flex items-start justify-between">
                  <div>
                    <p class="text-xs uppercase tracking-wide text-muted-foreground">{{ card.label }}</p>
                    <p class="mt-2 text-2xl font-semibold">{{ card.value }}</p>
                    <p v-if="card.delta" class="mt-1 text-xs text-muted-foreground">{{ card.delta }}</p>
                  </div>
                  <UIcon :name="card.icon" class="size-5 text-primary" />
                </div>
              </UCard>
            </template>
          </div>
        </section>

      </UContainer>
    </UPageBody>
  </UPage>
</template>

<script setup lang="ts">
import { computed, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { authClient } from '~/utils/auth-client'

import type { ButtonProps } from '#ui/types'

import type {
  ClientDashboardMetric,
  ClientDashboardResponse,
  MeResponse,
  DashboardData,
} from '#shared/types/dashboard'
import type { AccountSessionsResponse } from '#shared/types/auth'

definePageMeta({
  auth: true,
})

const { data: session } = await authClient.useSession(useFetch)

const headerLinks: ButtonProps[] = [
  {
    label: 'Account activity',
    icon: 'i-lucide-clock',
    to: '/account/activity',
    variant: 'soft',
    size: 'sm',
  },
  {
    label: 'Sessions',
    icon: 'i-lucide-shield',
    to: '/account/sessions',
    variant: 'soft',
    size: 'sm',
  },
]

const authStore = useAuthStore()
const { displayName } = storeToRefs(authStore)

const {
  data: meData,
  error: meError,
  refresh: refreshMe,
} = await useFetch<MeResponse>('/api/me', { key: 'dashboard-me' })

const {
  data: dashboardResponse,
  error: dashboardError,
  refresh: refreshDashboardData,
} = await useFetch<ClientDashboardResponse>('/api/dashboard', { key: 'dashboard-data' })

const {
  data: sessionsResponse,
  refresh: refreshSessions,
} = await useFetch<AccountSessionsResponse>('/api/account/sessions', { key: 'dashboard-sessions' })


const dashboardData = computed<DashboardData | null>(() => {
  if (!meData.value || !dashboardResponse.value || !sessionsResponse.value) {
    return null
  }

  const activeSessions = Array.isArray(sessionsResponse.value.data)
    ? sessionsResponse.value.data.length
    : 0

  const description = activeSessions === 0
    ? 'No active sessions'
    : `${activeSessions} device${activeSessions === 1 ? '' : 's'} signed in`

  const metrics = [...dashboardResponse.value.metrics]
  const replacementIndex = metrics.findIndex(metric => ['automationSchedules', 'automation_schedules', 'schedules-active'].includes(metric.key))
  const sessionsMetric: ClientDashboardMetric = {
    key: 'activeSessions',
    label: 'Active sessions',
    value: activeSessions,
    delta: description,
    icon: 'i-lucide-users',
  }

  if (replacementIndex >= 0) {
    metrics.splice(replacementIndex, 1, sessionsMetric)
  }
  else {
    metrics.push(sessionsMetric)
  }

  const meUser = meData.value?.user || null
    
  return {
    user: meUser,
    dashboard: {
      ...dashboardResponse.value,
      metrics,
    },
  }
})

const dashboardPending = computed(() => 
  !meData.value || !dashboardResponse.value || !sessionsResponse.value
)

const refreshDashboard = async () => {
  await Promise.all([
    refreshMe(),
    refreshDashboardData(),
    refreshSessions(),
  ])
}

watch(() => authStore.user?.username, async (newUsername, oldUsername) => {
  if (newUsername && newUsername !== oldUsername && oldUsername !== undefined) {
    await nextTick()
    await refreshDashboard()
  }
}, { immediate: false })

watch(() => authStore.displayName, async (newDisplayName, oldDisplayName) => {
  if (newDisplayName && newDisplayName !== oldDisplayName && oldDisplayName !== undefined) {
    await nextTick()
    await refreshDashboard()
  }
}, { immediate: false })

const metrics = computed<ClientDashboardMetric[]>(() => dashboardData.value?.dashboard.metrics ?? [])

function toErrorMessage(err: unknown, fallback: string) {
  if (!err) {
    return null
  }
  if (typeof err === 'string') {
    return err
  }
  if (err instanceof Error) {
    return err.message
  }
  if (typeof err === 'object' && err !== null && 'data' in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) {
      return data.message
    }
  }
  return fallback
}

const loading = computed(() => dashboardPending.value)
const error = computed<string | null>(() => {
  if (meError.value) return toErrorMessage(meError.value, 'Failed to load user data.')
  if (dashboardError.value) return toErrorMessage(dashboardError.value, 'Failed to load dashboard overview.')
  return null
})

const userName = computed(() => {
  const sessionUser = session.value?.user
  if (sessionUser) {
    if (sessionUser.username) return sessionUser.username
    if (sessionUser.email) return sessionUser.email
    if (sessionUser.name) return sessionUser.name
  }
  
  if (!authStore.isAuthenticated || !authStore.user) {
    return null
  }
  
  const authUser = authStore.user
  
  if (authUser.username) {
    return authUser.username
  }
  
  if (authUser.email) {
    return authUser.email
  }
  
  if (authUser.name) {
    return authUser.name
  }

  const resolved = displayName.value
  if (resolved && resolved.length > 0) {
    return resolved
  }

  const meUser = dashboardData.value?.user ?? null
  if (meUser && typeof meUser === 'object' && 'username' in meUser) {
    return (meUser as { username?: string; email?: string }).username || (meUser as { email?: string }).email || null
  }

  return null
})

const welcomeTitle = computed(() => {
  if (userName.value) {
    return `Welcome back, ${userName.value}`
  }
  return 'Welcome'
})
</script>