<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AdminUserProfilePayload, PaginatedServersResponse, PaginatedApiKeysResponse, PaginatedActivityResponse } from '#shared/types/admin'

definePageMeta({
  auth: true,
  layout: 'admin',
  adminTitle: 'User profile',
  adminSubtitle: 'Inspect panel access, owned servers, and activity',
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const actionLoading = ref<string | null>(null)
const isActionRunning = (key: string) => actionLoading.value === key

const userId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = await useFetch<AdminUserProfilePayload>(
  () => `/api/admin/users/${userId.value}`,
  {
    immediate: true,
    watch: [userId],
  },
)

async function runAction<T>(
  key: string,
  task: () => Promise<T>,
  options: { refreshAfter?: boolean; successMessage?: string } = {},
): Promise<T | undefined> {
  if (actionLoading.value) {
    return undefined
  }

  actionLoading.value = key

  try {
    const result = await task()

    if (options.refreshAfter !== false) {
      await refresh()
    }

    if (options.successMessage) {
      toast.add({
        title: 'Success',
        description: options.successMessage,
        color: 'success',
      })
    }

    return result
  }
  catch (error) {
    const description = error instanceof Error ? error.message : 'An unexpected error occurred.'
    toast.add({
      title: 'Action failed',
      description,
      color: 'error',
    })
    return undefined
  }
  finally {
    actionLoading.value = null
  }
}

watch(error, (value) => {
  if (value) {
    toast.add({
      title: 'Failed to load user profile',
      description: value.statusMessage || value.message,
      color: 'error',
    })

    if (value.statusCode === 404) {
      router.replace('/admin/users')
    }
  }
})

const profile = computed(() => data.value)
const user = computed(() => profile.value?.user)

const { data: advancedSettings } = await useFetch<{ paginationLimit: number }>('/api/admin/settings/advanced', {
  key: 'admin-settings-advanced',
  default: () => ({ paginationLimit: 25 }),
})
const itemsPerPage = computed(() => advancedSettings.value?.paginationLimit ?? 25)

const { data: serversData } = await useFetch<PaginatedServersResponse>(
  () => `/api/admin/users/${userId.value}/servers`,
  {
    key: `admin-user-servers-${userId.value}`,
    query: computed(() => ({ page: 1, limit: 1 })),
    default: () => ({ data: [], pagination: { page: 1, perPage: 1, total: 0, totalPages: 0 } }),
  },
)

const { data: apiKeysData } = await useFetch<PaginatedApiKeysResponse>(
  () => `/api/admin/users/${userId.value}/api-keys`,
  {
    key: `admin-user-api-keys-${userId.value}`,
    query: computed(() => ({ page: 1, limit: 1 })),
    default: () => ({ data: [], pagination: { page: 1, perPage: 1, total: 0, totalPages: 0 } }),
  },
)

const { data: activityData } = await useFetch<PaginatedActivityResponse>(
  () => `/api/admin/users/${userId.value}/activity`,
  {
    key: `admin-user-activity-${userId.value}`,
    query: computed(() => ({ page: 1, limit: 1 })),
    default: () => ({ data: [], pagination: { page: 1, perPage: 1, total: 0, totalPages: 0 } }),
  },
)

const serversPagination = computed(() => serversData.value?.pagination)
const apiKeysPagination = computed(() => apiKeysData.value?.pagination)
const activityPagination = computed(() => activityData.value?.pagination)

const isSuspended = computed(() => Boolean(user.value?.suspended))
const hasTwoFactor = computed(() => Boolean(user.value?.twoFactorEnabled))
const hasVerifiedEmail = computed(() => Boolean(user.value?.emailVerified))
const requiresPasswordReset = computed(() => Boolean(user.value?.passwordResetRequired))
const hasEmail = computed(() => Boolean(user.value?.email))

const tab = ref<'overview' | 'servers' | 'api-keys' | 'activity'>('overview')
const controlsOpen = ref(false)

const tabItems = computed(() => [
  { label: 'Overview', value: 'overview', icon: 'i-lucide-layout-dashboard' },
  { label: `Servers (${serversPagination.value?.total ?? 0})`, value: 'servers', icon: 'i-lucide-server' },
  { label: `API keys (${apiKeysPagination.value?.total ?? 0})`, value: 'api-keys', icon: 'i-lucide-key' },
  { label: `Activity (${activityPagination.value?.total ?? 0})`, value: 'activity', icon: 'i-lucide-activity' },
])

function formatDate(value: string | null | undefined) {
  if (!value)
    return 'Unknown'

  return new Date(value).toLocaleString()
}

const isLoading = computed(() => pending.value && !profile.value)

async function sendResetLink(notify = true) {
  if (!user.value)
    return

  await runAction('reset-link', async () => {
    return await $fetch<{ success: boolean }>(
      `/api/admin/users/${userId.value}/actions/reset-password`,
      {
        method: 'POST',
        body: {
          mode: 'link',
          notify,
        },
      },
    )
  }, {
    successMessage: notify
      ? 'Password reset link generated and emailed to the user.'
      : 'Password reset link generated.',
  })
}

async function setTemporaryPassword() {
  if (!user.value)
    return

  const response = await runAction('reset-temp', async () => {
    return await $fetch<{ success: boolean; temporaryPassword: string }>(
      `/api/admin/users/${userId.value}/actions/reset-password`,
      {
        method: 'POST',
        body: {
          mode: 'temporary',
        },
      },
    )
  })

  if (!response?.temporaryPassword)
    return

  let copied = false

  if (import.meta.client && typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(response.temporaryPassword)
      copied = true
    }
    catch (error) {
      console.error('Failed to copy temporary password to clipboard', error)
    }
  }

  if (!copied && import.meta.client && typeof window !== 'undefined')
    window.prompt('Temporary password (copy before closing)', response.temporaryPassword)

  const baseMessage = 'User must update their password on next login.'
  toast.add({
    title: 'Temporary password generated',
    description: copied
      ? `Temporary password copied to clipboard. ${baseMessage}`
      : `Temporary password: ${response.temporaryPassword}\n${baseMessage}`,
    color: 'success',
  })
}

async function disableTwoFactor() {
  if (!user.value)
    return

  await runAction('disable-2fa', async () => {
    return await $fetch<{ success: boolean }>(
      `/api/admin/users/${userId.value}/actions/disable-2fa`,
      {
        method: 'POST',
      },
    )
  }, {
    successMessage: 'Two-factor authentication disabled for this user.',
  })
}

async function markEmailVerified() {
  if (!user.value || hasVerifiedEmail.value)
    return

  await runAction('email-verify', async () => {
    return await $fetch<{ success: boolean }>(
      `/api/admin/users/${userId.value}/actions/email-verification`,
      {
        method: 'POST',
        body: { action: 'mark-verified' },
      },
    )
  }, {
    successMessage: 'Email marked as verified.',
  })
}

async function markEmailUnverified() {
  if (!user.value || !hasVerifiedEmail.value)
    return

  await runAction('email-unverify', async () => {
    return await $fetch<{ success: boolean }>(
      `/api/admin/users/${userId.value}/actions/email-verification`,
      {
        method: 'POST',
        body: { action: 'mark-unverified' },
      },
    )
  }, {
    successMessage: 'Email marked as unverified.',
  })
}

async function resendVerificationEmail() {
  if (!user.value)
    return

  if (!hasEmail.value) {
    toast.add({
      title: 'No email address available',
      description: 'Add an email address before resending the verification link.',
      color: 'error',
    })
    return
  }

  await runAction('email-resend', async () => {
    return await $fetch<{ success: boolean }>(
      `/api/admin/users/${userId.value}/actions/email-verification`,
      {
        method: 'POST',
        body: { action: 'resend-link' },
      },
    )
  }, {
    refreshAfter: false,
    successMessage: 'Verification email re-sent.',
  })
}

async function toggleSuspension() {
  if (!user.value)
    return

  if (isSuspended.value) {
    if (import.meta.client && typeof window !== 'undefined' && !window.confirm('Unsuspend this user?'))
      return

    await runAction('unsuspend', async () => {
      return await $fetch<{ success: boolean }>(
        `/api/admin/users/${userId.value}/actions/suspension`,
        {
          method: 'POST',
          body: { action: 'unsuspend' },
        },
      )
    }, {
      successMessage: 'User unsuspended.',
    })

    return
  }

  if (import.meta.client && typeof window !== 'undefined' && !window.confirm('Suspend this user? This will revoke active sessions.'))
    return

  let reason: string | undefined
  if (import.meta.client && typeof window !== 'undefined') {
    const input = window.prompt('Provide a suspension reason (optional)')?.trim()
    reason = input && input.length > 0 ? input : undefined
  }

  await runAction('suspend', async () => {
    return await $fetch<{ success: boolean }>(
      `/api/admin/users/${userId.value}/actions/suspension`,
      {
        method: 'POST',
        body: {
          action: 'suspend',
          reason,
        },
      },
    )
  }, {
    successMessage: 'User suspended.',
  })
}

async function impersonateUser() {
  if (!user.value || isSuspended.value)
    return

  const response = await runAction('impersonate', async () => {
    return await $fetch<{ impersonateUrl: string; expiresAt: string }>(
      `/api/admin/users/${userId.value}/actions/impersonate`,
      {
        method: 'POST',
      },
    )
  }, {
    refreshAfter: false,
  })

  if (!response?.impersonateUrl)
    return

  const impersonateUrl = response.impersonateUrl
  let copied = false

  if (import.meta.client && typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(impersonateUrl)
      copied = true
    }
    catch (error) {
      console.error('Failed to copy impersonation link to clipboard', error)
    }
  }

  if (import.meta.client && typeof window !== 'undefined')
    window.open(impersonateUrl, '_blank', 'noopener')

  const expiresLabel = formatDate(response.expiresAt)
  toast.add({
    title: 'Impersonation link ready',
    description: copied
      ? `Link copied to clipboard. Expires at ${expiresLabel}.`
      : `Opened a new tab. Expires at ${expiresLabel}.`,
    color: 'success',
  })

  if (!copied && import.meta.client && typeof window !== 'undefined')
    window.prompt('Impersonation link (copy if needed)', impersonateUrl)
}
</script>

<template>
  <UPage>
    <UPageBody>
      <UContainer>
        <section class="space-y-6">
          <header class="flex flex-wrap items-center justify-between gap-3">
            <div v-if="user">
              <UUser
                :name="user.name || user.username"
                :description="user.email"
                :avatar="(() => {
                  const name = user.name || user.username || user.email
                  if (!name) return undefined
                  return {
                    alt: name,
                    text: name.slice(0, 2).toUpperCase(),
                  }
                })()"
                size="lg"
              />
            </div>
            <div v-else>
              <h1 class="text-xl font-semibold">Loading user…</h1>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                icon="i-lucide-sliders-horizontal"
                color="warning"
                variant="subtle"
                @click="controlsOpen = true"
              >
                User controls
              </UButton>
            </div>
          </header>

          <USlideover
            v-model:open="controlsOpen"
            title="User controls"
            description="Reset passwords, toggle verification, suspension, and impersonation actions."
            :ui="{ body: 'space-y-6', footer: 'justify-end gap-2' }"
          >
          <template #body>
            <div class="flex flex-col gap-4">
              <UCard variant="outline" :ui="{ body: 'space-y-3' }">
                <div class="space-y-2">
                  <p class="text-xs uppercase tracking-wide text-muted-foreground">Password</p>
                  <div class="flex flex-wrap items-center gap-2">
                    <UButton
                      icon="i-lucide-mail"
                      size="xs"
                      variant="outline"
                      color="primary"
                      :loading="isActionRunning('reset-link')"
                      @click="sendResetLink()"
                    >
                      Send reset link
                    </UButton>
                    <UButton
                      icon="i-lucide-key"
                      size="xs"
                      variant="outline"
                      color="neutral"
                      :loading="isActionRunning('reset-temp')"
                      @click="setTemporaryPassword"
                    >
                      Temporary password
                    </UButton>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    Generates a reset link or temporary password and revokes active sessions.
                  </p>
                </div>
              </UCard>

              <UCard variant="outline" :ui="{ body: 'space-y-3' }">
                <div class="space-y-2">
                  <p class="text-xs uppercase tracking-wide text-muted-foreground">Two-factor</p>
                  <div class="flex flex-wrap items-center gap-2">
                    <UButton
                      icon="i-lucide-shield-off"
                      size="xs"
                      variant="outline"
                      color="neutral"
                      :disabled="!hasTwoFactor"
                      :loading="isActionRunning('disable-2fa')"
                      @click="disableTwoFactor"
                    >
                      Disable 2FA
                    </UButton>
                  </div>
                  <p class="text-xs text-muted-foreground">Removes TOTP configuration and recovery tokens for this user.</p>
                </div>
              </UCard>

              <UCard variant="outline" :ui="{ body: 'space-y-3' }">
                <div class="space-y-2">
                  <p class="text-xs uppercase tracking-wide text-muted-foreground">Email verification</p>
                  <div class="flex flex-wrap items-center gap-2">
                    <UButton
                      icon="i-lucide-badge-check"
                      size="xs"
                      variant="outline"
                      color="primary"
                      :disabled="hasVerifiedEmail"
                      :loading="isActionRunning('email-verify')"
                      @click="markEmailVerified"
                    >
                      Mark verified
                    </UButton>
                    <UButton
                      icon="i-lucide-badge-x"
                      size="xs"
                      variant="outline"
                      color="neutral"
                      :disabled="!hasVerifiedEmail"
                      :loading="isActionRunning('email-unverify')"
                      @click="markEmailUnverified"
                    >
                      Mark unverified
                    </UButton>
                    <UButton
                      icon="i-lucide-mail-plus"
                      size="xs"
                      variant="outline"
                      color="neutral"
                      :loading="isActionRunning('email-resend')"
                      @click="resendVerificationEmail"
                    >
                      Resend email
                    </UButton>
                  </div>
                  <p class="text-xs text-muted-foreground">Update email verification state or resend the verification link.</p>
                </div>
              </UCard>

              <UCard variant="outline" :ui="{ body: 'space-y-3' }">
                <div class="space-y-2">
                  <p class="text-xs uppercase tracking-wide text-muted-foreground">Account state</p>
                  <div class="flex flex-wrap items-center gap-2">
                    <UButton
                      :icon="isSuspended ? 'i-lucide-user-check' : 'i-lucide-user-x'"
                      size="xs"
                      variant="outline"
                      :color="isSuspended ? 'primary' : 'error'"
                      :loading="isActionRunning(isSuspended ? 'unsuspend' : 'suspend')"
                      @click="toggleSuspension"
                    >
                      {{ isSuspended ? 'Unsuspend user' : 'Suspend user' }}
                    </UButton>
                    <UButton
                      icon="i-lucide-user-cog"
                      size="xs"
                      variant="outline"
                      color="primary"
                      :disabled="isSuspended"
                      :loading="isActionRunning('impersonate')"
                      @click="impersonateUser"
                    >
                      Start impersonation
                    </UButton>
                  </div>
                  <p class="text-xs text-muted-foreground">Suspension revokes active sessions; impersonation generates a temporary sign-in link.</p>
                </div>
              </UCard>
            </div>
          </template>

        </USlideover>

        <div v-if="isLoading" class="grid gap-4 xl:grid-cols-3">
          <div
            v-for="i in 3"
            :key="`skeleton-${i}`"
            class="space-y-3 rounded-lg border border-dashed border-default/60 bg-muted/30 p-4"
          >
            <USkeleton class="h-4 w-32" />
            <USkeleton class="h-3 w-24" />
            <USkeleton class="h-24 w-full" />
          </div>
        </div>

        <div v-else-if="profile" class="space-y-6">
          <div v-if="isSuspended || requiresPasswordReset" class="space-y-3">
            <UAlert v-if="isSuspended" color="error" variant="soft" icon="i-lucide-ban">
              <template #title>Account suspended</template>
              <template #description>
                <p>Active sessions have been revoked and the user cannot sign in.</p>
                <p v-if="user?.suspensionReason" class="mt-2 text-xs text-muted-foreground">Reason: {{ user.suspensionReason }}</p>
                <p v-if="user?.suspendedAt" class="mt-1 text-xs text-muted-foreground">Suspended at {{ formatDate(user.suspendedAt) }}</p>
              </template>
            </UAlert>
            <UAlert v-if="requiresPasswordReset" color="warning" variant="soft" icon="i-lucide-alert-triangle">
              <template #title>Password reset required</template>
              <template #description>
                <p>The user must set a new password on their next login.</p>
              </template>
            </UAlert>
          </div>

          <UTabs v-model="tab" variant="link" :items="tabItems" class="w-full" />

          <AdminUserOverviewTab v-if="tab === 'overview'" :profile="profile" />
          <AdminUserServersTab v-else-if="tab === 'servers'" :user-id="userId" :items-per-page="itemsPerPage" />
          <AdminUserApiKeysTab v-else-if="tab === 'api-keys'" :user-id="userId" :items-per-page="itemsPerPage" />
          <AdminUserActivityTab v-else-if="tab === 'activity'" :user-id="userId" :items-per-page="itemsPerPage" />
        </div>
        </section>
      </UContainer>
    </UPageBody>

  </UPage>
</template>
