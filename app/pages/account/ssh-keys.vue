<script setup lang="ts">
import { ref, computed, reactive } from 'vue'

definePageMeta({
  auth: true,
  layout: 'default',
})

const toast = useToast()
const isCreating = ref(false)
const showCreateModal = ref(false)
const showDeleteModal = ref(false)
const keyToDelete = ref<string | null>(null)
const isDeleting = ref(false)

const createForm = reactive({
  name: '',
  publicKey: '',
})

const { data: keysData, refresh } = await useAsyncData('account-ssh-keys', () => 
  $fetch('/api/account/ssh-keys')
)

const sshKeys = computed(() => keysData.value?.data || [])
const expandedKeys = ref<Set<string>>(new Set())

function toggleKey(id: string) {
  if (expandedKeys.value.has(id)) {
    expandedKeys.value.delete(id)
  } else {
    expandedKeys.value.add(id)
  }
}

function formatJson(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2)
}

function getFullKeyData(key: typeof sshKeys.value[0]) {
  return {
    id: key.id,
    name: key.name,
    fingerprint: key.fingerprint,
    public_key: key.public_key,
    created_at: key.created_at,
  }
}

async function copyJson(key: typeof sshKeys.value[0]) {
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
      description: 'SSH key data JSON has been copied.',
    })
  } catch (error) {
    toast.add({
      title: 'Failed to copy',
      description: error instanceof Error ? error.message : 'Unable to copy to clipboard.',
      color: 'error',
    })
  }
}

async function createSshKey() {
  isCreating.value = true
  try {
    await $fetch('/api/account/ssh-keys', {
      method: 'POST',
      body: {
        name: createForm.name,
        public_key: createForm.publicKey,
      },
    })

    createForm.name = ''
    createForm.publicKey = ''
    showCreateModal.value = false

    await refresh()

    toast.add({
      title: 'SSH Key Added',
      description: 'Your SSH key has been added successfully',
      color: 'success',
    })
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || 'Failed to add SSH key',
      color: 'error',
    })
  }
  finally {
    isCreating.value = false
  }
}

function openDeleteModal(id: string) {
  keyToDelete.value = id
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (!keyToDelete.value) return

  isDeleting.value = true
  try {
    await $fetch(`/api/account/ssh-keys/${keyToDelete.value}`, {
      method: 'DELETE',
    })

    await refresh()
    showDeleteModal.value = false
    keyToDelete.value = null

    toast.add({
      title: 'SSH Key Deleted',
      description: 'The SSH key has been removed',
      color: 'success',
    })
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || 'Failed to delete SSH key',
      color: 'error',
    })
  }
  finally {
    isDeleting.value = false
  }
}

</script>

<template>
  <UPage>
    <UContainer>
      <UPageHeader title="SSH Keys" description="Manage SSH keys for SFTP access to your servers">
        <template #links>
          <UButton variant="subtle" icon="i-lucide-plus" @click="showCreateModal = true">
            Add SSH Key
          </UButton>
        </template>
      </UPageHeader>
    </UContainer>

    <UModal
      v-model:open="showCreateModal"
      title="Add SSH Key"
      description="Add a new SSH key for secure SFTP access to your servers"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="createSshKey">
          <UFormField label="Name" name="name" required>
            <UInput
              v-model="createForm.name"
              placeholder="My Laptop"
              class="w-full"
              required
            />
          </UFormField>

          <UFormField
            label="Public Key"
            name="publicKey"
            required
            help="Paste your SSH public key (starts with ssh-rsa, ssh-ed25519, etc.)"
          >
            <UTextarea
              v-model="createForm.publicKey"
              placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..."
              :rows="6"
              class="w-full"
              required
            />
          </UFormField>
        </form>
      </template>

      <template #footer="{ close }">
        <div class="flex justify-end gap-2">
          <UButton
            variant="ghost"
            color="error"
            :disabled="isCreating"
            @click="close"
          >
            Cancel
          </UButton>
          <UButton
            icon="i-lucide-plus"
            color="primary"
            variant="subtle"
            :loading="isCreating"
            :disabled="isCreating"
            @click="createSshKey"
          >
            Add SSH Key
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="showDeleteModal"
      title="Delete SSH Key"
      description="Are you sure you want to delete this SSH key? This action cannot be undone."
    >
      <template #body>
        <UAlert
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          title="Warning"
          description="Deleting this SSH key will immediately revoke SFTP access for this key. Make sure you have another way to access your servers."
        />
      </template>

      <template #footer="{ close }">
        <div class="flex justify-end gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            :disabled="isDeleting"
            @click="close"
          >
            Cancel
          </UButton>
          <UButton
            variant="solid"
            color="error"
            icon="i-lucide-trash"
            :loading="isDeleting"
            :disabled="isDeleting"
            @click="confirmDelete"
          >
            Delete SSH Key
          </UButton>
        </div>
      </template>
    </UModal>

    <UPageBody>
      <UContainer>
        <UCard :ui="{ body: 'space-y-3' }">
          <template #header>
            <div class="space-y-1">
              <h2 class="text-lg font-semibold">Configured SSH Keys</h2>
              <p class="text-sm text-muted-foreground">Add SSH keys to access your servers over SFTP.</p>
            </div>
          </template>
          <UEmpty
            v-if="sshKeys.length === 0"
            icon="i-lucide-key-round"
            title="No SSH keys yet"
            description="Add an SSH key to securely access your servers via SFTP"
          />

          <div v-else class="space-y-3">
            <div
              v-for="key in sshKeys"
              :key="key.id"
              class="rounded-lg border border-default overflow-hidden"
            >
              <button
                class="w-full flex items-center gap-3 p-3 text-left hover:bg-elevated/50 transition-colors"
                @click="toggleKey(key.id)"
              >
                <UIcon
                  name="i-lucide-key-round"
                  class="size-5 shrink-0 text-primary"
                />
                
                <div class="flex-1 min-w-0 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div class="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-sm font-medium font-mono">{{ key.name }}</span>
                      <UIcon
                        :name="expandedKeys.has(key.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                        class="size-4 text-muted-foreground shrink-0"
                      />
                    </div>
                    <div class="flex items-center gap-2 text-xs text-muted-foreground">
                      <span class="font-medium">Fingerprint:</span>
                      <code class="text-xs font-mono">{{ key.fingerprint }}</code>
                    </div>
                  </div>

                  <div class="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    <span class="truncate">
                      Added:
                      <NuxtTime :datetime="key.created_at" class="font-medium" />
                    </span>
                  </div>

                  <div class="flex items-center gap-2 shrink-0">
                    <UButton
                      variant="ghost"
                      color="error"
                      size="xs"
                      icon="i-lucide-trash"
                      :loading="isDeleting"
                      :disabled="isDeleting"
                      @click.stop="openDeleteModal(key.id)"
                    >
                      Delete
                    </UButton>
                  </div>
                </div>
              </button>
              
              <div
                v-if="expandedKeys.has(key.id)"
                class="border-t border-default bg-muted/30 p-4"
              >
                <div class="space-y-2">
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SSH Key Data</p>
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

