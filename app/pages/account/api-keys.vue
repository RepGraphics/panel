<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue'
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ApiKeyResponse } from '#shared/types/api'

definePageMeta({
  auth: true,
  layout: 'default',
})

const toast = useToast()
const showCreateModal = ref(false)
const showDeleteModal = ref(false)
const keyToDelete = ref<string | null>(null)
const isDeleting = ref(false)
const newKeyToken = ref<string | null>(null)
const isCreating = ref(false)
const copySuccess = ref(false)
const createError = ref<string | null>(null)

const keySchema = z.object({
  memo: z.string().trim().max(255, 'Memo must be under 255 characters').optional().default(''),
  allowedIps: z.string().trim().optional().default('')
    .refine(value => {
      if (!value)
        return true

      return value.split(',').every((ip) => {
        const trimmed = ip.trim()
        if (!trimmed)
          return false

        const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/
        return ipv4Regex.test(trimmed)
      })
    }, 'Enter valid IPv4 addresses separated by commas.'),
})

type KeyFormSchema = z.output<typeof keySchema>

const createForm = reactive<KeyFormSchema>(keySchema.parse({}))

const {
  data: keysData,
  pending: keysPending,
  refresh: refreshKeys,
  error: keysError,
} = await useFetch('/api/account/api-keys', {
  key: 'account-api-keys',
})

const apiKeys = computed(() => keysData.value?.data ?? [])
const showSkeleton = computed(() => keysPending.value && apiKeys.value.length === 0)
const loadError = computed(() => {
  const err = keysError.value
  if (!err)
    return null

  if (err instanceof Error)
    return err.message

  return 'Unable to load API keys. Try refreshing the page.'
})

const expandedKeys = ref<Set<string>>(new Set())

function toggleKey(identifier: string) {
  if (expandedKeys.value.has(identifier)) {
    expandedKeys.value.delete(identifier)
  } else {
    expandedKeys.value.add(identifier)
  }
}

function formatJson(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2)
}

function getFullKeyData(key: typeof apiKeys.value[0]) {
  return {
    identifier: key.identifier,
    description: key.description,
    allowed_ips: (key as { allowed_ips?: string[] }).allowed_ips || [],
    last_used_at: key.last_used_at,
    created_at: key.created_at,
  }
}

async function copyJson(key: typeof apiKeys.value[0]) {
  const json = formatJson(getFullKeyData(key))
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
      description: 'API key data JSON has been copied.',
    })
  } catch (error) {
    toast.add({
      title: 'Failed to copy',
      description: error instanceof Error ? error.message : 'Unable to copy to clipboard.',
      color: 'error',
    })
  }
}

function resetCreateState() {
  createError.value = null
  copySuccess.value = false
  newKeyToken.value = null
  Object.assign(createForm, keySchema.parse({}))
}

watch(showCreateModal, (open) => {
  if (!open && !newKeyToken.value) {
    resetCreateState()
  }
})

async function createApiKey(event: FormSubmitEvent<KeyFormSchema>) {
  if (isCreating.value)
    return

  isCreating.value = true
  createError.value = null
  newKeyToken.value = null
  copySuccess.value = false

  try {
    const payload = event.data
    const allowedIps = payload.allowedIps
      .split(',')
      .map(ip => ip.trim())
      .filter(Boolean)

    const formattedIps = allowedIps.length > 0 ? allowedIps : null

    const response = await $fetch<ApiKeyResponse>('/api/account/api-keys', {
      method: 'POST',
      body: {
        memo: payload.memo && payload.memo.length > 0 ? payload.memo : null,
        allowedIps: formattedIps,
      },
    })

    if (!response?.meta?.secret_token) {
      throw new Error('API key was created but token was not returned')
    }

    newKeyToken.value = response.meta.secret_token
    Object.assign(createForm, keySchema.parse({}))
    showCreateModal.value = true

    await refreshKeys()
  }
  catch (error) {
    console.error('Failed to create API key:', error)
    
    let message = 'Failed to create API key'
    if (error && typeof error === 'object') {
      const err = error as { data?: { message?: string }, message?: string, statusMessage?: string }
      message = err.data?.message || err.message || err.statusMessage || message
    }

    createError.value = message

    toast.add({
      title: 'Error',
      description: message,
      color: 'error',
    })
  }
  finally {
    isCreating.value = false
  }
}

function openDeleteModal(identifier: string) {
  keyToDelete.value = identifier
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (!keyToDelete.value) {
    return
  }

  isDeleting.value = true

  try {
    await $fetch(`/api/account/api-keys/${keyToDelete.value}`, {
      method: 'DELETE',
    })

    await refreshKeys()

    showDeleteModal.value = false
    keyToDelete.value = null

    toast.add({
      title: 'API Key Deleted',
      description: 'The API key has been removed',
      color: 'success',
    })
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || 'Failed to delete API key',
      color: 'error',
    })
  }
  finally {
    isDeleting.value = false
  }
}

async function copyToken() {
  if (!newKeyToken.value)
    return

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(newKeyToken.value)
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = newKeyToken.value
      textArea.style.position = 'fixed'
      textArea.style.left = '-999999px'
      textArea.style.top = '-999999px'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      
      const successful = document.execCommand('copy')
      document.body.removeChild(textArea)
      
      if (!successful) {
        throw new Error('execCommand copy failed')
      }
    }
    
    copySuccess.value = true
    toast.add({
      title: 'Copied',
      description: 'API key copied to clipboard',
      color: 'success',
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to copy token'
    toast.add({
      title: 'Copy failed',
      description: message,
      color: 'error',
    })
  }
}
</script>

<template>
  <UPage>
    <UContainer>
      <UPageHeader title="API Keys" description="Manage your API keys for programmatic access">
        <template #links>
          <UButton variant="subtle" icon="i-lucide-plus" @click="showCreateModal = true">
            Create API Key
          </UButton>
        </template>
      </UPageHeader>
    </UContainer>

    <UModal
      v-model:open="showCreateModal"
      :title="newKeyToken ? 'API Key Created' : 'Create API Key'"
      :description="newKeyToken ? 'Copy your API key now – it will not be shown again.' : 'Generate a personal API key for programmatic access'"
      :dismissible="!newKeyToken"
      :ui="{ body: 'space-y-4', footer: 'flex justify-end gap-2' }"
    >
      <template #body>
        <div v-if="newKeyToken" class="space-y-4">
          <UAlert color="warning" variant="soft" icon="i-lucide-alert-triangle">
            <template #title>Save this token now!</template>
            <template #description>
              You won't be able to see it again after closing this dialog.
            </template>
          </UAlert>

          <div class="space-y-2">
            <label class="text-sm font-medium">Your API Key</label>
            <div class="flex gap-2">
              <UInput
                :model-value="newKeyToken"
                readonly
                icon="i-lucide-key"
                class="flex-1 font-mono text-sm"
              />
              <UButton
                icon="i-lucide-copy"
                variant="soft"
                @click="copyToken"
              >
                Copy
              </UButton>
            </div>
          </div>
        </div>

        <div v-else class="space-y-4">
          <UAlert v-if="createError" color="error" icon="i-lucide-alert-triangle">
            <template #title>Unable to create key</template>
            <template #description>{{ createError }}</template>
          </UAlert>

          <UForm
            :schema="keySchema"
            :state="createForm"
            class="space-y-4"
            :disabled="isCreating"
            @submit="createApiKey"
          >
            <UFormField label="Description (optional)" name="memo">
              <UInput
                v-model="createForm.memo"
                icon="i-lucide-file-text"
                placeholder="My API Key"
                class="w-full"
              />
              <template #help>
                A friendly name to help identify this key
              </template>
            </UFormField>

            <UFormField
              label="Allowed IPs (optional)"
              name="allowedIps"
            >
              <UTextarea
                v-model="createForm.allowedIps"
                icon="i-lucide-shield"
                placeholder="192.168.1.1, 10.0.0.1"
                class="w-full"
                :rows="3"
              />
              <template #help>
                Comma-separated list of IPv4 addresses. Leave empty to allow all IPs.
              </template>
            </UFormField>
          </UForm>
        </div>
      </template>

      <template #footer="{ close }">
        <template v-if="!newKeyToken">
          <UButton
            variant="ghost"
            color="neutral"
            :disabled="isCreating"
            @click="() => {
              showCreateModal = false
              close()
            }"
          >
            Cancel
          </UButton>
          <UButton
            type="submit"
            form=""
            icon="i-lucide-plus"
            color="primary"
            variant="subtle"
            :loading="isCreating"
            :disabled="isCreating"
            @click="() => createApiKey({ data: createForm } as unknown as FormSubmitEvent<KeyFormSchema>)"
          >
            Create Key
          </UButton>
        </template>
        <template v-else>
          <UButton
            color="primary"
            icon="i-lucide-check"
            @click="() => {
              newKeyToken = null
              showCreateModal = false
              close()
            }"
          >
            Done
          </UButton>
        </template>
      </template>
    </UModal>

    <UModal
      v-model:open="showDeleteModal"
      title="Delete API Key"
      description="This action cannot be undone. The API key will be permanently removed."
      :ui="{ footer: 'flex justify-end gap-2' }"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert color="error" variant="soft" icon="i-lucide-alert-triangle">
            <template #title>Warning</template>
            <template #description>
              Are you sure you want to delete this API key? Any applications using this key will lose access immediately.
            </template>
          </UAlert>
          <div v-if="keyToDelete" class="rounded-md bg-muted p-3">
            <p class="text-sm font-medium">Key Identifier:</p>
            <code class="text-sm font-mono mt-1">{{ keyToDelete }}</code>
          </div>
        </div>
      </template>

      <template #footer="{ close }">
        <UButton
          variant="ghost"
          color="neutral"
          :disabled="isDeleting"
          @click="() => {
            showDeleteModal = false
            keyToDelete = null
            close()
          }"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          :loading="isDeleting"
          :disabled="isDeleting"
          @click="confirmDelete"
        >
          Delete Key
        </UButton>
      </template>
    </UModal>

    <UPageBody>
      <UContainer>
        <UCard :ui="{ body: 'space-y-3' }">
          <template #header>
            <div class="space-y-1">
              <h2 class="text-lg font-semibold">Active API Keys</h2>
              <p class="text-sm text-muted-foreground">Manage existing keys or create new ones for API access.</p>
            </div>
          </template>
          <UAlert v-if="loadError" color="error" icon="i-lucide-alert-triangle" class="mb-4">
            <template #title>Unable to load keys</template>
            <template #description>{{ loadError }}</template>
          </UAlert>

          <div v-if="showSkeleton" class="space-y-3">
            <USkeleton class="h-16 w-full rounded-md" />
            <USkeleton class="h-16 w-full rounded-md" />
          </div>

          <UEmpty
            v-else-if="apiKeys.length === 0"
            icon="i-lucide-key"
            title="No API keys yet"
            description="Create an API key to access the panel programmatically"
          />

          <div v-else class="space-y-3">
            <div
              v-for="key in apiKeys"
              :key="key.identifier"
              class="rounded-lg border border-default overflow-hidden"
            >
              <button
                class="w-full flex items-center gap-3 p-3 text-left hover:bg-elevated/50 transition-colors"
                @click="toggleKey(key.identifier)"
              >
                <UIcon
                  name="i-lucide-key"
                  class="size-5 shrink-0 text-primary"
                />
                
                <div class="flex-1 min-w-0 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div class="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <div class="flex items-center gap-2 min-w-0">
                      <code class="text-sm font-medium font-mono">{{ key.identifier }}</code>
                      <UIcon
                        :name="expandedKeys.has(key.identifier) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                        class="size-4 text-muted-foreground shrink-0"
                      />
                    </div>
                    <UBadge v-if="(key as any).allowed_ips?.length" color="primary" variant="soft" size="xs">
                      IP Restricted
                    </UBadge>
                    <p v-if="key.description" class="text-sm text-muted-foreground">
                      {{ key.description }}
                    </p>
                  </div>

                  <div class="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    <span class="truncate">
                      Created:
                      <NuxtTime :datetime="key.created_at" class="font-medium" />
                    </span>
                    <span v-if="key.last_used_at" class="hidden sm:inline">•</span>
                    <span v-if="key.last_used_at" class="truncate">
                      Last used:
                      <NuxtTime :datetime="key.last_used_at" class="font-medium" />
                    </span>
                  </div>

                  <div class="flex items-center gap-2 shrink-0">
                    <UButton
                      variant="ghost"
                      color="error"
                      size="xs"
                      icon="i-lucide-trash-2"
                      :loading="isDeleting"
                      :disabled="isDeleting"
                      @click.stop="openDeleteModal(key.identifier)"
                    >
                      Delete
                    </UButton>
                  </div>
                </div>
              </button>
              
              <div
                v-if="expandedKeys.has(key.identifier)"
                class="border-t border-default bg-muted/30 p-4"
              >
                <div class="space-y-2">
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">API Key Data</p>
                    <UButton
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-copy"
                      @click.stop="copyJson(key)"
                    >
                      Copy JSON
                    </UButton>
                  </div>
                  <pre class="text-xs font-mono bg-default rounded-lg p-3 overflow-x-auto border border-default"><code>{{ formatJson(getFullKeyData(key)) }}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </UContainer>
    </UPageBody>
  </UPage>
</template>

