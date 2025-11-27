<script setup lang="ts">
const route = useRoute()

definePageMeta({
  auth: true,
  layout: 'server',
})

const serverId = computed(() => route.params.id as string)
const toast = useToast()

const { data: startupData, pending, error, refresh } = await useAsyncData(
  `server-${serverId.value}-startup`,
  () => $fetch<{ data: { startup: string } }>(`/api/servers/${serverId.value}/startup`),
  {
    watch: [serverId],
  },
)

const startup = computed(() => {
  const response = startupData.value
  return response && typeof response === 'object' && 'data' in response && typeof response.data === 'object' && response.data && 'startup' in response.data && typeof response.data.startup === 'string'
    ? response.data.startup
    : ''
})
const dockerImage = computed(() => startupResponse?.data?.dockerImage || '')
const dockerImages = computed(() => startupResponse?.data?.dockerImages || {})
const environment = computed(() => startupResponse?.data?.environment || {})

const hasMultipleDockerImages = computed(() => Object.keys(dockerImages.value).length > 1)

const isCustomDockerImage = computed(() => {
  const images = Object.values(dockerImages.value)
  return images.length > 0 && !images.includes(dockerImage.value)
})

const selectedDockerImage = ref<string>(dockerImage.value)
const isChangingDockerImage = ref(false)

watch(dockerImage, (newImage) => {
  selectedDockerImage.value = newImage
}, { immediate: true })

const dockerImageOptions = computed(() => {
  return Object.entries(dockerImages.value).map(([key, value]) => ({
    label: `${key} (${value})`,
    value: value as string,
  }))
})

async function updateDockerImage() {
  console.log('[Client Startup] Update Docker Image clicked!', {
    serverId: serverId.value,
    currentImage: dockerImage.value,
    selectedImage: selectedDockerImage.value,
    timestamp: new Date().toISOString(),
  })

  if (selectedDockerImage.value === dockerImage.value) {
    console.warn('[Client Startup] No change - selected image is same as current')
    toast.add({
      title: 'No Changes',
      description: 'Docker image is already set to this value',
      color: 'primary',
    })
    return
  }

  const images = Object.values(dockerImages.value)
  console.log('[Client Startup] Validating image against egg list:', {
    selectedImage: selectedDockerImage.value,
    validImages: images,
    isValid: images.includes(selectedDockerImage.value),
  })

  if (images.length > 0 && !images.includes(selectedDockerImage.value)) {
    console.error('[Client Startup] Invalid image - not in egg list')
    toast.add({
      title: 'Invalid Image',
      description: 'This server\'s Docker image can only be changed to one from the egg\'s list.',
      color: 'error',
    })
    return
  }

  isChangingDockerImage.value = true
  try {
    console.log('[Client Startup] Making PUT request to:', `/api/servers/${serverId.value}/settings/docker-image`)
    
    const response = await $fetch(`/api/servers/${serverId.value}/docker-image`, {
      method: 'PUT',
      body: { dockerImage: selectedDockerImage.value },
    })
    
    console.log('[Client Startup] PUT request successful:', response)

    toast.add({
      title: 'Docker Image Updated',
      description: 'The Docker image has been updated. Restart your server for changes to take effect.',
      color: 'success',
    })

    await refresh()
  }
  catch (error) {
    console.error('[Client Startup] PUT request failed:', error)
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || 'Failed to update Docker image',
      color: 'error',
    })
    
    selectedDockerImage.value = dockerImage.value
  }
  finally {
    isChangingDockerImage.value = false
    console.log('[Client Startup] Docker image update complete')
  }
}
</script>

<template>
  <UPage>
    <UPageBody>
      <UContainer>
        <section class="space-y-6">
          <header class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p class="text-xs text-muted-foreground">Server {{ serverId }} · Startup</p>
              <h1 class="text-xl font-semibold">Startup Configuration</h1>
            </div>
          </header>

          <div v-if="error" class="rounded-lg border border-error/20 bg-error/5 p-4 text-sm text-error">
            <div class="flex items-start gap-2">
              <UIcon name="i-lucide-alert-circle" class="mt-0.5 size-4" />
              <div>
                <p class="font-medium">Failed to load startup configuration</p>
                <p class="mt-1 text-xs opacity-80">{{ error.message }}</p>
              </div>
            </div>
          </div>

          <div v-else-if="pending" class="flex items-center justify-center py-12">
            <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted-foreground" />
          </div>

          <template v-else>
            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-rocket" class="size-5" />
                  <h2 class="text-lg font-semibold">Startup Command</h2>
                </div>
              </template>

              <div class="space-y-4">
                <div class="rounded-md border border-default bg-muted/30 p-4">
                  <p class="text-xs uppercase tracking-wide text-muted-foreground mb-2">Current Startup Command</p>
                  <code class="text-sm font-mono text-foreground">{{ startup }}</code>
                </div>

                <UAlert color="primary" icon="i-lucide-info">
                  <template #description>
                    The startup command is configured by your server administrator and cannot be changed.
                  </template>
                </UAlert>
              </div>
            </UCard>

            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-container" class="size-5" />
                  <h2 class="text-lg font-semibold">Docker Image</h2>
                </div>
              </template>

              <div class="space-y-4">
                <div v-if="hasMultipleDockerImages && !isCustomDockerImage">
                  <UFormField
                    label="Docker Image"
                    name="dockerImage"
                    description="The Docker image used to run this server instance"
                  >
                    <USelectMenu
                      v-model="selectedDockerImage"
                      :items="dockerImageOptions"
                      value-key="value"
                      class="w-full"
                    />
                  </UFormField>

                  <div class="flex justify-end mt-4">
                    <UButton
                      icon="i-lucide-check"
                      color="primary"
                      :loading="isChangingDockerImage"
                      :disabled="isChangingDockerImage || selectedDockerImage === dockerImage"
                      @click="updateDockerImage"
                    >
                      Update Docker Image
                    </UButton>
                  </div>
                </div>

                <div v-else class="rounded-md border border-default bg-muted/30 p-4">
                  <p class="text-xs uppercase tracking-wide text-muted-foreground mb-2">Current Docker Image</p>
                  <code class="text-sm font-mono text-foreground">{{ dockerImage }}</code>
                  
                  <UAlert v-if="isCustomDockerImage" color="warning" icon="i-lucide-alert-triangle" class="mt-4">
                    <template #description>
                      This server's Docker image has been manually set by an administrator and cannot be changed.
                    </template>
                  </UAlert>

                  <UAlert v-else color="primary" icon="i-lucide-info" class="mt-4">
                    <template #description>
                      This egg only provides one Docker image option. Contact an administrator to change it.
                    </template>
                  </UAlert>
                </div>
              </div>
            </UCard>

            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-variable" class="size-5" />
                  <h2 class="text-lg font-semibold">Environment Variables</h2>
                </div>
              </template>

              <ServerEmptyState
                v-if="Object.keys(environment).length === 0"
                icon="i-lucide-variable"
                title="No environment variables"
                description="Environment variables will appear here when configured by an administrator."
              />

              <div v-else class="grid gap-3">
                <div
                  v-for="(value, key) in environment"
                  :key="key"
                  class="rounded-md border border-default bg-muted/30 p-4"
                >
                  <p class="text-xs uppercase tracking-wide text-muted-foreground mb-2">{{ key }}</p>
                  <code class="text-sm font-mono text-foreground break-all">{{ value }}</code>
                </div>
              </div>

              <template #footer>
                <UAlert color="primary" icon="i-lucide-info">
                  <template #description>
                    Environment variables are configured by your server administrator and cannot be changed.
                  </template>
                </UAlert>
              </template>
            </UCard>
          </template>
        </section>
      </UContainer>
    </UPageBody>

    <template #right>
      <UPageAside />
    </template>
  </UPage>
</template>
