<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Server, ServerLimits } from '#shared/types/server'

const props = defineProps<{
  server: Server
}>()

const toast = useToast()
const isSubmitting = ref(false)

const {
  data: limitsData,
  pending: limitsPending,
  refresh: refreshLimits,
} = await useAsyncData<ServerLimits | null>(
  `server-limits-${props.server.id}`,
  async () => {
    try {
      const response = await $fetch<{ data: ServerLimits }>(`/api/admin/servers/${props.server.id}/limits`)
      return response.data
    }
    catch (error) {
      console.error('Failed to load server limits', error)
      return null
    }
  },
  {
    default: () => null,
  },
)

const limits = computed(() => limitsData.value)

const schema = z.object({
  cpu: z.number({ invalid_type_error: 'CPU limit must be a number' }).min(0, 'CPU limit cannot be negative'),
  threads: z.union([
    z.string().trim().min(1).max(191),
    z.literal('').transform(() => null),
    z.null(),
  ]).transform(value => (value === '' ? null : value)),
  memory: z.number({ invalid_type_error: 'Memory limit must be a number' }).min(0, 'Memory limit cannot be negative'),
  swap: z.number({ invalid_type_error: 'Swap must be a number' }).min(-1, 'Swap must be -1 or greater'),
  disk: z.number({ invalid_type_error: 'Disk limit must be a number' }).min(0, 'Disk limit cannot be negative'),
  io: z.number({ invalid_type_error: 'Block I/O must be a number' }).min(10, 'Block I/O must be at least 10').max(1000, 'Block I/O cannot exceed 1000'),
})

type FormSchema = z.infer<typeof schema>

function createFormState(payload: ServerLimits | null): FormSchema {
  return {
    cpu: Number(payload?.cpu ?? 0),
    threads: payload?.threads ?? null,
    memory: Number(payload?.memory ?? 0),
    swap: Number(payload?.swap ?? 0),
    disk: Number(payload?.disk ?? 0),
    io: Number(payload?.io ?? 500),
  }
}

const form = reactive<FormSchema>(createFormState(limits.value))

watch(limits, (value) => {
  Object.assign(form, createFormState(value))
})

async function handleSubmit(event: FormSubmitEvent<FormSchema>) {
  if (isSubmitting.value)
    return

  isSubmitting.value = true

  try {
    await $fetch(`/api/admin/servers/${props.server.id}/build`, {
      method: 'PATCH',
      body: {
        ...event.data,
        threads: event.data.threads ?? null,
      },
    })

    Object.assign(form, event.data)
    await refreshLimits()

    toast.add({
      title: 'Build updated',
      description: 'Server resource limits have been saved',
      color: 'success',
    })
  }
  catch (error) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err.data?.message || 'Failed to update build configuration',
      color: 'error',
    })
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UForm
    :schema="schema"
    :state="form"
    class="space-y-6"
    :disabled="isSubmitting"
    :validate-on="['input']"
    @submit="handleSubmit"
  >
    <UAlert icon="i-lucide-info" variant="subtle">
      <template #title>Resource Limits</template>
      <template #description>
        Configure CPU, memory, disk, and I/O limits for this server. Set to 0 for unlimited.
      </template>
    </UAlert>

    <div v-if="limitsPending" class="grid gap-4 md:grid-cols-2">
      <UCard v-for="i in 4" :key="`build-skeleton-${i}`" class="space-y-3">
        <USkeleton class="h-4 w-1/3" />
        <USkeleton class="h-10 w-full" />
      </UCard>
    </div>

    <div v-else class="grid gap-4 md:grid-cols-2">
      <UFormField label="CPU Limit (%)" name="cpu" required>
        <UInput v-model.number="form.cpu" type="number" placeholder="100" class="w-full" />
        <template #help>
          Percentage of CPU (100 = 1 core, 200 = 2 cores). 0 = unlimited.
        </template>
      </UFormField>

      <UFormField label="CPU Threads" name="threads">
        <UInput v-model="form.threads" placeholder="Leave empty for all threads" class="w-full" />
        <template #help>
          Specific CPU threads to use (e.g., "0,1,2" or "0-3"). Leave empty to use all.
        </template>
      </UFormField>

      <UFormField label="Memory Limit (MB)" name="memory" required>
        <UInput v-model.number="form.memory" type="number" placeholder="2048" class="w-full" />
        <template #help>
          Maximum memory in megabytes. 0 = unlimited.
        </template>
      </UFormField>

      <UFormField label="Swap (MB)" name="swap" required>
        <UInput v-model.number="form.swap" type="number" placeholder="0" class="w-full" />
        <template #help>
          Swap memory in megabytes. -1 = unlimited, 0 = disabled.
        </template>
      </UFormField>

      <UFormField label="Disk Space (MB)" name="disk" required>
        <UInput v-model.number="form.disk" type="number" placeholder="10240" class="w-full" />
        <template #help>
          Maximum disk space in megabytes. 0 = unlimited.
        </template>
      </UFormField>

      <UFormField label="Block I/O Weight" name="io" required>
        <UInput v-model.number="form.io" type="number" min="10" max="1000" placeholder="500" class="w-full" />
        <template #help>
          I/O performance (10-1000). Higher = better performance.
        </template>
      </UFormField>
    </div>

    <div class="flex justify-end">
      <UButton type="submit" color="primary" :loading="isSubmitting" :disabled="isSubmitting">
        Save Build Configuration
      </UButton>
    </div>
  </UForm>
</template>
